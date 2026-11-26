import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import type { PodcastOverlap } from '@scorm/contracts';

/** Frequenza di lavoro del mixaggio: quella delle voci generative (24 kHz, mono). */
export const MIX_RATE = 24_000;
const FADE_MS = 6;

/** Esegue ffmpeg con l'ingresso su stdin e restituisce stdout. Rifiuta se manca o se fallisce. */
function ffmpeg(args: string[], input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-v', 'error', '-nostdin', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg ha fallito (${code}): ${Buffer.concat(err).toString('utf8').slice(0, 300)}`));
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

let available: Promise<boolean> | null = null;
/** True se ffmpeg è installato (si controlla una volta sola). */
export function ffmpegAvailable(): Promise<boolean> {
  available ??= new Promise<boolean>((resolve) => {
    const child = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
  return available;
}

/** Decodifica un MP3 in campioni a 16 bit, mono, a 24 kHz. */
export async function decodeToPcm(mp3: Uint8Array, tempo = 1): Promise<Int16Array> {
  // `tempo` accelera o rallenta senza cambiare l'intonazione della voce.
  const filter = Math.abs(tempo - 1) > 0.01 ? ['-af', `atempo=${Math.min(2, Math.max(0.5, tempo)).toFixed(3)}`] : [];
  const raw = await ffmpeg(['-i', 'pipe:0', ...filter, '-f', 's16le', '-ac', '1', '-ar', String(MIX_RATE), 'pipe:1'], Buffer.from(mp3));
  // Si copia in un buffer allineato: il pool di Node non garantisce l'allineamento a 2 byte.
  const aligned = new Uint8Array(raw.length - (raw.length % 2));
  aligned.set(raw.subarray(0, aligned.length));
  return new Int16Array(aligned.buffer);
}

/** Codifica campioni a 16 bit (mono, 24 kHz) in MP3. */
export async function encodeMp3(pcm: Int16Array): Promise<Buffer> {
  const input = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return ffmpeg(['-f', 's16le', '-ar', String(MIX_RATE), '-ac', '1', '-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', 'pipe:1'], input);
}

export interface MixTrack {
  pcm: Int16Array;
  startMs: number;
  /** Moltiplicatore di volume (1 = invariato). */
  gain: number;
}

/**
 * Somma le tracce sulla linea del tempo. Ogni traccia ha una breve dissolvenza all'inizio e alla fine
 * (niente scatti dove si taglia) e il risultato passa da un limitatore morbido, così le
 * sovrapposizioni non distorcono.
 */
export function mixPcm(tracks: MixTrack[], totalMs: number): Int16Array {
  const total = Math.max(1, Math.ceil((totalMs / 1000) * MIX_RATE));
  const acc = new Float32Array(total);
  const fade = Math.round((FADE_MS / 1000) * MIX_RATE);
  for (const t of tracks) {
    const offset = Math.max(0, Math.round((t.startMs / 1000) * MIX_RATE));
    const n = Math.min(t.pcm.length, total - offset);
    for (let i = 0; i < n; i++) {
      const edge = Math.min(1, i / fade, (t.pcm.length - 1 - i) / fade);
      acc[offset + i]! += (t.pcm[i]! / 32768) * t.gain * (edge < 1 ? Math.max(0, edge) : 1);
    }
  }
  const out = new Int16Array(total);
  for (let i = 0; i < total; i++) {
    const v = acc[i]!;
    // Limitatore morbido: lineare fino a 0.8, poi comprime senza superare 1.
    const a = Math.abs(v);
    const shaped = a <= 0.8 ? a : 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2);
    out[i] = Math.round(Math.sign(v) * shaped * 32767);
  }
  return out;
}

export interface TimelineTurn {
  durationMs: number;
  overlap?: PodcastOverlap;
  /** Chi parla: serve a capire se dopo una reazione riprende la stessa persona. */
  host?: string;
}
export interface TimelineSlot {
  startMs: number;
  endMs: number;
  gain: number;
}

/**
 * Colloca le battute nel tempo. `gap(i)` dà la pausa prima della battuta i quando non si sovrappone.
 * - cut_in: parte poco prima che l'altro finisca;
 * - reaction: breve, sopra le ultime parole dell'altro, a volume più basso; non ferma il discorso:
 *   se riprende chi parlava, riparte subito, come in una conversazione vera;
 * - over: ci si parla sopra per un momento.
 */
export function planTimeline(turns: TimelineTurn[], gap: (i: number) => number): { slots: TimelineSlot[]; totalMs: number } {
  const slots: TimelineSlot[] = [];
  let cursor = 0; // fine del discorso "principale"
  let end = 0; // fine di tutto ciò che è stato detto finora (reazioni comprese)
  let hostBeforeReaction: string | undefined;
  let afterReaction = false;
  turns.forEach((t, i) => {
    let start: number;
    let gain = 1;
    const kind = i === 0 ? undefined : t.overlap;
    switch (kind) {
      case 'cut_in':
        start = Math.max(0, cursor - (150 + ((i * 37) % 110)));
        break;
      case 'reaction':
        start = Math.max(0, cursor - Math.min(Math.max(t.durationMs * 0.6, 220), 700));
        gain = 0.6;
        break;
      case 'over':
        start = Math.max(0, cursor - Math.min(t.durationMs * 0.5, 900));
        gain = 0.9;
        break;
      default:
        if (i === 0) start = 0;
        else if (afterReaction && t.host === hostBeforeReaction) start = cursor + 70;
        else if (afterReaction) start = Math.max(cursor, end) + 90;
        else start = cursor + gap(i);
    }
    const stop = start + t.durationMs;
    slots.push({ startMs: Math.round(start), endMs: Math.round(stop), gain });
    end = Math.max(end, stop);
    if (kind === 'reaction') {
      // Il discorso principale non avanza: la reazione sta sopra.
      if (!afterReaction) hostBeforeReaction = turns[i - 1]?.host;
      afterReaction = true;
    } else {
      cursor = Math.max(cursor, stop);
      afterReaction = false;
    }
  });
  return { slots, totalMs: Math.round(end) };
}
