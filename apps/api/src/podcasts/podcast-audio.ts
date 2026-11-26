import { Buffer } from 'node:buffer';
import { MIX_RATE, decodeToPcm, encodeMp3, ffmpegAvailable, mixPcm, planTimeline } from './podcast-mix.js';
import { mp3DurationMs, splitTextForTts } from '@scorm/adapters/polly';
import { PODCAST_LIMITS, PodcastMood, type PodcastOverlap, type PodcastScript, type PodcastTurnTiming } from '@scorm/contracts';

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
  if (/[\u2014\u2013-]$/.test(prev)) return 20;
  if (wordCount(nextText) <= 4) return 90;
  if (wordCount(prev) <= 4) return 110;
  const jitter = ((index * 7919) % 11) * 12;
  if (/\?$/.test(prev)) return 150 + jitter;
  if (/(\.\.\.|\u2026)$/.test(prev)) return 180 + jitter;
  return 200 + jitter;
}

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
  raw: { turns?: Array<{ host?: string; text?: string; overlap?: string; mood?: string }> },
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
    let overlap = t.overlap && OVERLAPS.has(t.overlap) ? (t.overlap as PodcastOverlap) : undefined;
    const prev = turns[turns.length - 1];
    // Sovrapposizioni possibili solo su un'altra persona già in scena.
    if (!prev || prev.host === host) overlap = undefined;
    if (overlap === 'reaction' && text.split(/\s+/).length > REACTION_MAX_WORDS) overlap = undefined;
    // Un'interruzione richiede che l'altro sia rimasto a metà frase: altrimenti ci si parla sopra.
    if (overlap === 'cut_in' && prev && !/[\u2014\u2013-]\s*$/.test(prev.text)) overlap = 'over';
    const pieces = text.length > PODCAST_LIMITS.maxTurnChars ? splitTextForTts(text, Math.floor(PODCAST_LIMITS.maxTurnChars * 0.8)) : [text];
    pieces.forEach((piece, k) => {
      const clean = piece.trim();
      if (!clean) return;
      turns.push({ host, text: clean.slice(0, PODCAST_LIMITS.maxTurnChars), ...(k === 0 && overlap ? { overlap } : {}), ...(mood ? { mood } : {}) });
    });
  }
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

/**
 * Unisce le battute in un solo MP3 come in una conversazione: dove il copione prevede interruzioni,
 * reazioni o sovrapposizioni le battute si sovrappongono davvero (serve ffmpeg). Senza ffmpeg, o
 * senza sovrapposizioni, si uniscono una dopo l'altra con pause brevi (come `assembleAudio`).
 */
export async function assembleDialogue(
  parts: Array<{ bytes: Uint8Array; text: string; overlap?: PodcastOverlap; host?: string }>,
): Promise<{ audio: Buffer; timings: PodcastTurnTiming[]; durationMs: number; mixed: boolean }> {
  const wantsMix = parts.some((p) => p.overlap) && (await ffmpegAvailable());
  if (!wantsMix) return { ...assembleAudio(parts), mixed: false };
  const pcms = await Promise.all(parts.map((p) => decodeToPcm(stripId3(Buffer.from(p.bytes)))));
  const turns = pcms.map((pcm, i) => ({ durationMs: Math.round((pcm.length / MIX_RATE) * 1000), overlap: parts[i]!.overlap, host: parts[i]!.host }));
  const { slots, totalMs } = planTimeline(turns, (i) => gapBetween(parts[i - 1]!.text, parts[i]!.text, i - 1));
  const mixed = mixPcm(
    pcms.map((pcm, i) => ({ pcm, startMs: slots[i]!.startMs, gain: slots[i]!.gain })),
    totalMs + 200,
  );
  const audio = await encodeMp3(mixed);
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
};
/** Testo da sintetizzare: con le voci HeyGen il tono della battuta diventa un\u2019etichetta; con Polly resta solo la punteggiatura. */
export function textForVoice(turn: { text: string; mood?: PodcastMood }, provider: 'polly' | 'heygen'): string {
  return provider === 'heygen' && turn.mood ? `${HEYGEN_MOOD_TAGS[turn.mood]} ${turn.text}` : turn.text;
}
