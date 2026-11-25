import { Buffer } from 'node:buffer';
import { mp3DurationMs, splitTextForTts } from '@scorm/adapters/polly';
import { PODCAST_LIMITS, type PodcastScript, type PodcastTurnTiming } from '@scorm/contracts';

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

/**
 * Unisce gli MP3 delle battute in un solo file, con una pausa tra una battuta e l'altra, e calcola
 * inizio e fine di ogni battuta (dalla durata reale dei file). La pausa non si aggiunge dopo l'ultima.
 */
export function assembleAudio(
  parts: Array<{ bytes: Uint8Array; text: string }>,
  pauseMs = 380,
): { audio: Buffer; timings: PodcastTurnTiming[]; durationMs: number } {
  const pause = silence(pauseMs);
  const pauseReal = mp3DurationMs(pause) || pauseMs;
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
    if (i < parts.length - 1) {
      buffers.push(pause);
      cursor += pauseReal;
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

/**
 * Sistema il copione scritto dall'AI: pulisce le battute, divide quelle troppo lunghe alla fine di
 * una frase e scarta le vuote. Restituisce anche i problemi che rendono il copione inutilizzabile
 * (troppo corto, un solo conduttore, troppe battute).
 */
export function tidyScript(raw: { turns?: Array<{ host?: string; text?: string }> }): {
  script: PodcastScript;
  problems: string[];
} {
  const turns: PodcastScript['turns'] = [];
  for (const t of raw.turns ?? []) {
    const host = t.host === 'B' ? 'B' : t.host === 'A' ? 'A' : null;
    const text = cleanTurnText(String(t.text ?? ''));
    if (!host || !text) continue;
    const pieces = text.length > PODCAST_LIMITS.maxTurnChars ? splitTextForTts(text, Math.floor(PODCAST_LIMITS.maxTurnChars * 0.8)) : [text];
    for (const piece of pieces) {
      const clean = piece.trim();
      if (clean) turns.push({ host, text: clean.slice(0, PODCAST_LIMITS.maxTurnChars) });
    }
  }
  const problems: string[] = [];
  if (turns.length < PODCAST_LIMITS.minTurns) problems.push(`copione troppo corto (${turns.length} battute)`);
  if (turns.length > PODCAST_LIMITS.maxTurns) problems.push(`troppe battute (${turns.length})`);
  if (turns.length > 0 && new Set(turns.map((t) => t.host)).size < 2) problems.push('parla un solo conduttore');
  return { script: { turns: turns.slice(0, PODCAST_LIMITS.maxTurns) }, problems };
}

/** Caratteri da sintetizzare per un copione (base del costo dell'audio). */
export function scriptChars(script: { turns: Array<{ text: string }> }): number {
  return script.turns.reduce((n, t) => n + t.text.length, 0);
}
