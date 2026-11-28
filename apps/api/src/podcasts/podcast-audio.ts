import { Buffer } from 'node:buffer';
import { MIX_RATE, decodeToPcm, ffmpegAvailable, masterToMp3, mixPcm, planTimeline, shapeBackchannel, trimSilence } from './podcast-mix.js';
import { mp3DurationMs, splitTextForTts } from '@scorm/adapters/polly';
import { PODCAST_LIMITS, PodcastMood, type PodcastEnergy, type PodcastOverlap, type PodcastScript, type PodcastTurnTiming } from '@scorm/contracts';

/**
 * Frame MP3 di silenzio: MPEG-2 Layer III, 24 kHz, mono, 32 kbit/s (96 byte, 24 ms). 24 kHz è la
 * frequenza predefinita delle voci generative di Polly: i file si concatenano senza ricodifica.
 * Intestazione: sync + MPEG-2/Layer III/senza CRC (FF F3), 32 kbit/s e 24 kHz (44), mono (C0).
 */
const SILENCE_FRAME = Buffer.concat([Buffer.from([0xff, 0xf3, 0x44, 0xc0]), Buffer.alloc(92)]);
const SILENCE_FRAME_MS = 24;

/** MP3 di silenzio lungo circa `ms` millisecondi. */
export function silence(ms: number): Buffer {
  const frames = Math.max(1, Math.round(ms / SILENCE_FRAME_MS));
  return Buffer.concat(Array.from({ length: frames }, () => SILENCE_FRAME));
}

/** Toglie un eventuale tag ID3v2 iniziale (in mezzo a un file concatenato darebbe disturbi). */
export function stripId3(buf: Buffer): Buffer {
  if (buf.length > 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size = ((buf[6]! & 0x7f) << 21) | ((buf[7]! & 0x7f) << 14) | ((buf[8]! & 0x7f) << 7) | (buf[9]! & 0x7f);
    return buf.subarray(10 + size);
  }
  return buf;
}

/** Durata stimata (ms) di un testo parlato, per quando la durata dell'MP3 non si legge. */
export function estimateSpeechMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.round((words / PODCAST_LIMITS.wordsPerMinute) * 60_000);
}

const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/**
 * Pausa (ms) tra una battuta e la successiva, come in una conversazione vera: quasi nulla se chi
 * parla è stato interrotto o se segue una reazione breve, più lunga dopo una domanda o un punto,
 * con una piccola variazione per non suonare a metronomo (deterministica: stesso copione, stesso audio).
 */
export function gapBetween(prevText: string, nextText: string, index: number): number {
  const prev = prevText.trim();
  // Il silenzio tra un turno e l'altro è minimo: è ciò che fa incalzare la conversazione.
  if (/[\u2014\u2013-]$/.test(prev)) return 0;
  if (wordCount(nextText) <= 4) return 40;
  if (wordCount(prev) <= 4) return 60;
  const jitter = ((index * 7919) % 11) * 8;
  if (/\?$/.test(prev)) return 70 + jitter;
  if (/(\.\.\.|\u2026)$/.test(prev)) return 110 + jitter;
  return 90 + jitter;
}

/** Interiezione non lessicale: "mh", "eh", "ehm", "ah", "oh", "uh", "boh"… */
export const INTERJECTION = /^[\s"«»]*(?:m+h+m*|e+h+m*|u+h+m*|a+h+|o+h+|boh|mah|uff|eh|ah ah|ahah+)[\s.,!?…\u2014-]*$/i;

/** Numero pseudo-casuale in [0,1) per l'indice (stesso copione, stesso audio). */
function unit(i: number): number {
  const x = Math.sin((i + 1) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Pausa naturale tra due battute (ms). In una conversazione vera le pause non hanno una durata fissa: spesso quasi nulle,
 * a volte un respiro, di rado un silenzio vero (si pensa, si ride, si cambia discorso).
 */
export function naturalGap(prevText: string, nextText: string, index: number): number {
  const prev = prevText.trim();
  const next = nextText.trim();
  if (/[\u2014\u2013-]$/.test(prev)) return 0; // interrotto: chi arriva parte subito
  const u = unit(index);
  let gap: number;
  if (u < 0.3) gap = 10 + u * 150; // quasi attaccato
  else if (u < 0.65) gap = 60 + (u - 0.3) * 340; // respiro
  else if (u < 0.88) gap = 180 + (u - 0.65) * 950; // pausa breve
  else if (u < 0.97) gap = 400 + (u - 0.88) * 4400; // pausa lunga
  else gap = 900 + (u - 0.97) * 30000; // silenzio vero, raro
  if (/\?$/.test(prev)) gap = Math.min(gap, 260); // alle domande si risponde in fretta…
  if (/^(ehm|boh|mah|allora|cioè|vabbè|beh|ecco|uhm)\b/i.test(next)) gap += 140; // …a meno che si esiti
  if (/(\.\.\.|\u2026)$/.test(prev)) gap = Math.max(gap, 220);
  if (/\bah(\s?ah)+|ahah|\[laughs\]/i.test(prev)) gap += 280; // dopo una risata si riprende fiato
  if (INTERJECTION.test(next) || wordCount(next) <= 2) gap = Math.min(gap, 140);
  return Math.round(gap);
}

/** Velocità di lettura di partenza secondo l'energia (1 = naturale): un dialogo vero è un po' più rapido della lettura. */
export const ENERGY_SPEED: Record<PodcastEnergy, number> = { relaxed: 1, lively: 1.08, wild: 1.12 };

/**
 * Unisce gli MP3 delle battute in un solo file, con le pause di `gapBetween`, e calcola inizio e fine
 * di ogni battuta (dalla durata reale dei file). La pausa non si aggiunge dopo l'ultima.
 */
export function assembleAudio(
  parts: Array<{ bytes: Uint8Array; text: string }>,
): { audio: Buffer; timings: PodcastTurnTiming[]; durationMs: number } {
  const buffers: Buffer[] = [];
  const timings: PodcastTurnTiming[] = [];
  let cursor = 0;
  parts.forEach((p, i) => {
    const data = stripId3(Buffer.from(p.bytes));
    const measured = mp3DurationMs(data);
    const dur = measured > 0 ? measured : estimateSpeechMs(p.text);
    timings.push({ i, startMs: Math.round(cursor), endMs: Math.round(cursor + dur) });
    buffers.push(data);
    cursor += dur;
    const next = parts[i + 1];
    if (next) {
      const gap = gapBetween(p.text, next.text, i);
      const pause = silence(gap);
      buffers.push(pause);
      cursor += mp3DurationMs(pause) || gap;
    }
  });
  return { audio: Buffer.concat(buffers), timings, durationMs: Math.round(cursor) };
}

/** Ripulisce il testo di una battuta: niente markdown, indicazioni di scena o spazi doppi. */
export function cleanTurnText(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[*_#`~>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Distanza minima (in battute) tra due interiezioni isolate ("Mh.", "Eh.") o reazioni: più fitte suonano a ripetizione, non reali. */
const MIN_INTERJECTION_GAP = 7;

/** Toglie le interiezioni e le reazioni brevissime troppo ravvicinate: in una conversazione vera chi ascolta fa un verso ogni tanto, non a ogni frase. */
function limitInterjections(turns: PodcastScript['turns']): void {
  let last = -MIN_INTERJECTION_GAP;
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i]!;
    const tiny = (t.overlap === 'reaction' && t.text.split(/\s+/).length <= 3) || INTERJECTION.test(t.text);
    if (!tiny || i === 0) continue;
    if (i - last >= MIN_INTERJECTION_GAP) {
      last = i;
      continue;
    }
    turns.splice(i, 1);
    i--;
  }
}

/** Una risata scritta ("ah ah", "ahah") o un tono "laughing". */
const LAUGH_TEXT = /\b(?:ah[ ,]+){1,}ah\b|\bah(?:ah)+h?\b/gi;
/** Distanza minima (in battute) tra due risate: più vicine non sono credibili. */
const MIN_LAUGH_GAP = 5;

/** Toglie le risate troppo ravvicinate: la seconda è quasi sempre una ripetizione di tic, non una reazione vera. */
function limitLaughs(turns: PodcastScript['turns']): void {
  let last = -MIN_LAUGH_GAP;
  turns.forEach((t, i) => {
    const laughs = t.mood === 'laughing' || new RegExp(LAUGH_TEXT.source, 'i').test(t.text);
    if (!laughs) return;
    if (i - last >= MIN_LAUGH_GAP) {
      last = i;
      return;
    }
    if (t.mood === 'laughing') delete t.mood;
    const stripped = t.text.replace(LAUGH_TEXT, '').replace(/\s{2,}/g, ' ').replace(/^[,;:\s]+/, '').replace(/\s+([,.!?…])/g, '$1').trim();
    t.text = stripped || t.text;
  });
}

const OVERLAPS = new Set<string>(['cut_in', 'reaction', 'over']);
const MOODS = new Set<string>(PodcastMood.options);
/** Una reazione è una battuta di poche parole. */
const REACTION_MAX_WORDS = 6;

/**
 * Sistema il copione scritto dall'AI: pulisce le battute, divide quelle troppo lunghe alla fine di
 * una frase, scarta le vuote o di chi non c'è e rende coerenti le sovrapposizioni (un'interruzione
 * vuole la battuta precedente lasciata a metà, una reazione è breve, nessuno si sovrappone a sé
 * stesso). Restituisce anche i problemi che rendono il copione inutilizzabile (troppo corto,
 * un solo partecipante in una discussione, troppe battute).
 */
export function tidyScript(
  raw: { turns?: Array<{ host?: string; text?: string; overlap?: string; mood?: string; energy?: number }> },
  hostKeys: string[] = ['A', 'B'],
): {
  script: PodcastScript;
  problems: string[];
} {
  const keys = new Set(hostKeys);
  const turns: PodcastScript['turns'] = [];
  for (const t of raw.turns ?? []) {
    const host = t.host && keys.has(t.host) ? (t.host as PodcastScript['turns'][number]['host']) : null;
    const text = cleanTurnText(String(t.text ?? ''));
    if (!host || !text) continue;
    const mood = t.mood && MOODS.has(t.mood) ? (t.mood as PodcastMood) : undefined;
    const energy = typeof t.energy === 'number' && Number.isFinite(t.energy) ? Math.min(5, Math.max(1, Math.round(t.energy))) : undefined;
    let overlap = t.overlap && OVERLAPS.has(t.overlap) ? (t.overlap as PodcastOverlap) : undefined;
    const prev = turns[turns.length - 1];
    // Sovrapposizioni possibili solo su un'altra persona già in scena.
    if (!prev || prev.host === host) overlap = undefined;
    if (overlap === 'reaction' && text.split(/\s+/).length > REACTION_MAX_WORDS) overlap = undefined;
    // Un'interruzione richiede che l'altro sia rimasto a metà frase: altrimenti ci si parla sopra.
    const prevCutOff = prev ? /[\u2014\u2013-]\s*$/.test(prev.text) : false;
    if (overlap === 'cut_in' && !prevCutOff) overlap = 'over';
    // Se l'altro è rimasto a metà frase, chi risponde lo sta interrompendo: parte prima che finisca.
    if (!overlap && prev && prev.host !== host && prevCutOff) overlap = 'cut_in';
    const pieces = text.length > PODCAST_LIMITS.maxTurnChars ? splitTextForTts(text, Math.floor(PODCAST_LIMITS.maxTurnChars * 0.8)) : [text];
    pieces.forEach((piece, k) => {
      const clean = piece.trim();
      if (!clean) return;
      turns.push({ host, text: clean.slice(0, PODCAST_LIMITS.maxTurnChars), ...(k === 0 && overlap ? { overlap } : {}), ...(mood ? { mood } : {}), ...(energy ? { energy } : {}) });
    });
  }
  limitLaughs(turns);
  limitInterjections(turns);
  const problems: string[] = [];
  if (turns.length < PODCAST_LIMITS.minTurns) problems.push(`copione troppo corto (${turns.length} battute)`);
  if (turns.length > PODCAST_LIMITS.maxTurns) problems.push(`troppe battute (${turns.length})`);
  if (hostKeys.length > 1 && turns.length > 0 && new Set(turns.map((t) => t.host)).size < 2) problems.push('parla un solo partecipante');
  return { script: { turns: turns.slice(0, PODCAST_LIMITS.maxTurns) }, problems };
}
/** Caratteri da sintetizzare per un copione (base del costo dell'audio). */
export function scriptChars(script: { turns: Array<{ text: string }> }): number {
  return script.turns.reduce((n, t) => n + t.text.length, 0);
}

/** Quanto si stringono o si allungano le pause secondo l'energia della conversazione. */
const PACE: Record<PodcastEnergy, number> = { relaxed: 1.6, lively: 1, wild: 0.5 };

/**
 * Unisce le battute in un solo MP3 come in una conversazione: dove il copione prevede interruzioni,
 * reazioni o sovrapposizioni le battute si sovrappongono davvero (serve ffmpeg). Senza ffmpeg, o
 * senza sovrapposizioni, si uniscono una dopo l'altra con pause brevi (come `assembleAudio`).
 */
export async function assembleDialogue(
  parts: Array<{ bytes: Uint8Array; text: string; overlap?: PodcastOverlap; host?: string; tempo?: number; energy?: number }>,
  energy: PodcastEnergy = 'lively',
): Promise<{ audio: Buffer; timings: PodcastTurnTiming[]; durationMs: number; mixed: boolean }> {
  const wantsMix = parts.some((p) => p.overlap || (p.tempo !== undefined && Math.abs(p.tempo - 1) > 0.01)) && (await ffmpegAvailable());
  if (!wantsMix) return { ...assembleAudio(parts), mixed: false };
  const pcms = await Promise.all(
    parts.map(async (p) => {
      // Via il silenzio a inizio e fine; le interiezioni brevi si accorciano e si scuriscono.
      const raw = trimSilence(await decodeToPcm(stripId3(Buffer.from(p.bytes)), p.tempo ?? 1));
      return INTERJECTION.test(p.text) ? shapeBackchannel(raw) : raw;
    }),
  );
  const turns = pcms.map((pcm, i) => {
    const f = energyFactors(parts[i]!.energy ?? 3);
    return { durationMs: Math.round((pcm.length / MIX_RATE) * 1000), overlap: parts[i]!.overlap, host: parts[i]!.host, gapScale: f.gap, gain: f.gain };
  });
  const { slots, totalMs } = planTimeline(turns, (i) => Math.round(naturalGap(parts[i - 1]!.text, parts[i]!.text, i) * PACE[energy] * turns[i]!.gapScale));
  const mixed = mixPcm(
    pcms.map((pcm, i) => ({ pcm, startMs: slots[i]!.startMs, gain: slots[i]!.gain })),
    totalMs + 200,
  );
  const audio = await masterToMp3(mixed);
  const timings: PodcastTurnTiming[] = slots.map((x, i) => ({ i, startMs: x.startMs, endMs: x.endMs }));
  return { audio, timings, durationMs: Math.round((mixed.length / MIX_RATE) * 1000), mixed: true };
}

/** Etichette di tono che HeyGen interpreta (in inglese, tra parentesi quadre, prima del testo). */
const HEYGEN_MOOD_TAGS: Record<PodcastMood, string> = {
  excited: '[excited]',
  amused: '[chuckles]',
  surprised: '[surprised]',
  sarcastic: '[sarcastic]',
  warm: '[warm]',
  serious: '[serious]',
  calm: '[calm]',
  frustrated: '[frustrated]',
  thoughtful: '[hmm]',
  laughing: '[laughs]',
  shouting: '[shouts]',
  scoffing: '[scoffs]',
};
/** Testo da sintetizzare: con le voci HeyGen il tono della battuta diventa un\u2019etichetta; con Polly resta solo la punteggiatura. */
export function textForVoice(turn: { text: string; mood?: PodcastMood }, provider: 'polly' | 'heygen', language = 'it'): string {
  const base = spokenText(turn.text, language);
  if (provider !== 'heygen') return base;
  // Le interiezioni isolate ("Mh.", "Eh.", "Uff.") con HeyGen diventano suoni veri (etichette di evento) invece di parole lette in studio.
  const bare = base.trim().replace(/^[\s"«»]+|[\s.,!?…\u2014-]+$/g, '').toLowerCase();
  if (/^(?:m+h+m*|e+h+|uh+m*)$/.test(bare) && !/^e+h+m+$/.test(bare)) return '[hmm]';
  if (/^uff+$/.test(bare)) return '[sighs]';
  // Le risate scritte ("ah ah ah", "ahahah") diventano risate vere con le voci che le sanno fare.
  const text = base.replace(/\b(?:ah[ ,]+){1,}ah\b|\bah(?:ah)+h?\b/gi, '[laughs]');
  // Una risata da sola non si porta dietro la punteggiatura.
  const cleaned = text.replace(/^(\[laughs\])[\s!.?…]+$/, '$1');
  // Ogni etichetta di tono allunga la battuta di circa un secondo: sulle battute cortissime farebbe perdere ritmo, quindi lì resta solo la risata.
  const short = cleaned.split(/\s+/).length < 4;
  return turn.mood && (!short || turn.mood === 'laughing') ? `${HEYGEN_MOOD_TAGS[turn.mood]} ${cleaned}` : cleaned;
}

const UNITS = ['zero', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci', 'undici', 'dodici', 'tredici', 'quattordici', 'quindici', 'sedici', 'diciassette', 'diciotto', 'diciannove'];
const TENS = ['', '', 'venti', 'trenta', 'quaranta', 'cinquanta', 'sessanta', 'settanta', 'ottanta', 'novanta'];

/** Un intero in lettere, in italiano (da 0 a 999.999.999). */
export function numberToItalian(n: number): string {
  if (n < 20) return UNITS[n]!;
  if (n < 100) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    const base = TENS[t]!;
    if (u === 0) return base;
    // Elisione della vocale: ventuno, ventotto, trentuno…
    return (u === 1 || u === 8 ? base.slice(0, -1) : base) + (u === 3 ? 'tré' : UNITS[u]!);
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    const head = h === 1 ? 'cento' : `${UNITS[h]}cento`;
    if (r === 0) return head;
    // "centottanta", "centotto": cade la "o" di cento davanti a ottanta e a otto.
    const rest = numberToItalian(r);
    return (rest.startsWith('ott') ? head.slice(0, -1) : head) + rest;
  }
  if (n < 1_000_000) {
    const k = Math.floor(n / 1000);
    const r = n % 1000;
    const head = k === 1 ? 'mille' : `${numberToItalian(k)}mila`;
    return r === 0 ? head : head + numberToItalian(r);
  }
  const m = Math.floor(n / 1_000_000);
  const r = n % 1_000_000;
  const head = m === 1 ? 'un milione' : `${numberToItalian(m)} milioni`;
  return r === 0 ? head : `${head} ${numberToItalian(r)}`;
}

/**
 * Testo come va pronunciato: in italiano i numeri diventano parole ("2026" → "duemilaventisei", "30%" →
 * "trenta per cento"), così la voce non sbaglia la lettura. Le altre lingue restano invariate.
 */
export function spokenText(text: string, language: string): string {
  if (!language.toLowerCase().startsWith('it')) return text;
  // "Mmh" viene letto come un mugugno di tre secondi: la forma breve "Mh" rende il verso giusto.
  return text
    .replace(/\bm{2,}h+m*\b/gi, (m) => (m[0] === 'M' ? 'Mh' : 'mh'))
    .replace(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\s?%/g, (_m, i: string, d?: string) => `${spellInt(i)}${d ? ` virgola ${[...d].map((c) => UNITS[Number(c)]).join(' ')}` : ''} per cento`)
    .replace(/€\s?(\d{1,3}(?:\.\d{3})+|\d+)/g, (_m, i: string) => `${spellInt(i)} euro`)
    .replace(/(\d{1,3}(?:\.\d{3})+|\d+)\s?€/g, (_m, i: string) => `${spellInt(i)} euro`)
    .replace(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?/g, (_m, i: string, d?: string) => `${spellInt(i)}${d ? ` virgola ${[...d].map((c) => UNITS[Number(c)]).join(' ')}` : ''}`);
}
function spellInt(raw: string): string {
  const n = Number(raw.replace(/\./g, ''));
  return Number.isFinite(n) && n < 1_000_000_000 ? numberToItalian(n) : raw;
}

/**
 * Energia "sentita" di ogni battuta: la propria si mescola con quella di chi ha appena parlato, perché in una
 * conversazione l'umore si trasmette da una persona all'altra e cambia in modo graduale.
 */
export function smoothEnergies(
  turns: Array<{ energy?: number; overlap?: string; mood?: string; text?: string }>,
): number[] {
  const out: number[] = [];
  turns.forEach((t) => {
    // Ciò che è scritto nella battuta conta quanto il numero dato dal modello: interruzioni, risate e esclamazioni scaldano, riflessione e calma raffreddano.
    let own = t.energy ?? 3;
    if (t.overlap === 'cut_in' || t.overlap === 'over') own += 0.5;
    if (t.mood === 'excited' || t.mood === 'laughing' || t.mood === 'shouting' || t.mood === 'frustrated') own += 0.5;
    if (t.mood === 'calm' || t.mood === 'thoughtful') own -= 0.5;
    if (t.text && /!\s*$/.test(t.text)) own += 0.3;
    own = Math.min(5, Math.max(1, own));
    // L'umore si trasmette: la battuta è influenzata dalle ultime tre, quindi l'energia sale e scende a ondate, non a scatti.
    const prev = out.slice(-3);
    out.push(prev.length === 0 ? own : 0.45 * own + 0.55 * (prev.reduce((n, v) => n + v, 0) / prev.length));
  });
  return out;
}

/** Come l'energia (1-5) cambia velocità, pausa e volume di una battuta. */
export function energyFactors(energy: number): { speed: number; gap: number; gain: number } {
  const e = Math.min(5, Math.max(1, energy));
  return {
    speed: 0.9 + 0.05 * (e - 1), // da 0.90 a 1.10
    gap: 1.6 - 0.275 * (e - 1), // pause più lunghe se la conversazione è distesa, strette se è accesa
    gain: Math.pow(10, ((e - 3) * 1.0) / 20), // chi si scalda alza un po' la voce
  };
}
