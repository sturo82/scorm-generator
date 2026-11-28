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

/** Come `ffmpeg`, ma restituisce anche stderr (dove i filtri di misura scrivono i risultati). */
function ffmpegWithLog(args: string[], input: Buffer): Promise<{ out: Buffer; log: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-nostdin', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      const log = Buffer.concat(err).toString('utf8');
      if (code === 0) resolve({ out: Buffer.concat(out), log });
      else reject(new Error(`ffmpeg ha fallito (${code}): ${log.slice(-300)}`));
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

/** Volume di riferimento dei podcast sulle piattaforme (LUFS integrati) e picco massimo. */
export const TARGET_LUFS = -16;
export const TARGET_PEAK_DB = -1.5;

/** Catena di rifinitura della voce: taglia i rumori bassi, livella un po' le differenze di volume. */
const VOICE_CHAIN = 'highpass=f=70,acompressor=threshold=0.125:ratio=2.2:attack=20:release=250:makeup=1.4';

/**
 * Master finale: filtro passa-alto e compressione leggera, poi normalizzazione del volume a -16 LUFS (come chiedono Apple e
 * Spotify) con picco sotto -1,5 dB, misurata e applicata in due passaggi, e codifica MP3. Senza questo le puntate escono
 * troppo piano o troppo forte rispetto agli altri podcast.
 */
export async function masterToMp3(pcm: Int16Array): Promise<Buffer> {
  const input = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const raw = ['-f', 's16le', '-ar', String(MIX_RATE), '-ac', '1', '-i', 'pipe:0'];
  const target = `I=${TARGET_LUFS}:TP=${TARGET_PEAK_DB}:LRA=11`;
  // 1) misura
  const pass1 = await ffmpegWithLog([...raw, '-af', `${VOICE_CHAIN},loudnorm=${target}:print_format=json`, '-f', 'null', '-'], input);
  const m = /\{[^{}]*"input_i"[^{}]*\}/.exec(pass1.log);
  let loudnorm = `loudnorm=${target}`;
  if (m) {
    try {
      const j = JSON.parse(m[0]) as Record<string, string>;
      const ok = [j['input_i'], j['input_tp'], j['input_lra'], j['input_thresh'], j['target_offset']].every((v) => Number.isFinite(Number(v)));
      if (ok) loudnorm = `loudnorm=${target}:measured_I=${j['input_i']}:measured_TP=${j['input_tp']}:measured_LRA=${j['input_lra']}:measured_thresh=${j['input_thresh']}:offset=${j['target_offset']}:linear=true`;
    } catch {
      /* misura illeggibile: si usa la normalizzazione a un solo passaggio */
    }
  }
  // 2) applica e codifica (loudnorm lavora a 192 kHz: si torna a 24 kHz in uscita)
  const { out } = await ffmpegWithLog(
    [...raw, '-af', `${VOICE_CHAIN},${loudnorm}`, '-ar', String(MIX_RATE), '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '80k', '-f', 'mp3', 'pipe:1'],
    input,
  );
  return out;
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

/**
 * Toglie il silenzio digitale a inizio e fine di una clip (le voci sintetiche ne hanno 100-300 ms per lato): senza questo le
 * pause tra le battute risultano molto più lunghe di quelle volute e il ritmo suona a metronomo.
 */
export function trimSilence(pcm: Int16Array, leadMs = 12, tailMs = 70, threshold = 0.004): Int16Array {
  const limit = threshold * 32768;
  let a = 0;
  let b = pcm.length - 1;
  while (a < b && Math.abs(pcm[a]!) < limit) a++;
  while (b > a && Math.abs(pcm[b]!) < limit) b--;
  const start = Math.max(0, a - Math.round((leadMs / 1000) * MIX_RATE));
  const end = Math.min(pcm.length, b + 1 + Math.round((tailMs / 1000) * MIX_RATE));
  return pcm.subarray(start, Math.max(start + 1, end));
}

/** Passa-basso a un polo: toglie le alte frequenze, come una voce sentita da più lontano o "di sponda" da un altro microfono. */
export function lowPass(pcm: Int16Array, cutoffHz: number): Int16Array {
  const out = new Int16Array(pcm.length);
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoffHz) / MIX_RATE);
  let y = 0;
  for (let i = 0; i < pcm.length; i++) {
    y += alpha * (pcm[i]! - y);
    out[i] = Math.round(y);
  }
  return out;
}

/**
 * Un'interiezione ("mh", "eh", "ah") in una conversazione vera è breve, fiacca e non scandita: si accorcia con una
 * dissolvenza lunga e si scurisce un po', così non suona come una parola letta in studio.
 */
export function shapeBackchannel(pcm: Int16Array, maxMs = 480): Int16Array {
  const max = Math.round((maxMs / 1000) * MIX_RATE);
  const cut = pcm.length > max ? pcm.slice(0, max) : pcm.slice();
  const fade = Math.min(cut.length, Math.round(0.09 * MIX_RATE));
  for (let i = 0; i < fade; i++) cut[cut.length - 1 - i] = Math.round(cut[cut.length - 1 - i]! * (i / fade));
  return lowPass(cut, 3400);
}

/** Generatore pseudo-casuale con seme: stesso copione, stesso audio. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Mette tutte le voci nella stessa stanza: un velo di riverbero corto e un fruscio di fondo molto basso. Il silenzio digitale
 * tra una clip e l'altra è uno dei segni più netti di un parlato assemblato; con il "rumore di stanza" costante le pause suonano vere.
 */
export function addRoom(acc: Float32Array, wet = 0.07, noiseDb = -58): void {
  const ms = (m: number) => Math.round((m / 1000) * MIX_RATE);
  const combs = [ms(29.7), ms(37.1), ms(41.1), ms(43.7)].map((d) => ({ d, buf: new Float32Array(d), i: 0 }));
  const feedback = 0.74;
  const allpass = [ms(5), ms(1.7)].map((d) => ({ d, buf: new Float32Array(d), i: 0 }));
  const rand = rng(12345);
  const noiseAmp = Math.pow(10, noiseDb / 20);
  let n1 = 0;
  const dry = acc.slice();
  for (let t = 0; t < acc.length; t++) {
    const x = dry[t]!;
    let r = 0;
    for (const c of combs) {
      const y = c.buf[c.i]!;
      c.buf[c.i] = x + y * feedback;
      c.i = (c.i + 1) % c.d;
      r += y;
    }
    r /= combs.length;
    for (const a of allpass) {
      const y = a.buf[a.i]!;
      const out = -r + y;
      a.buf[a.i] = r + y * 0.5;
      a.i = (a.i + 1) % a.d;
      r = out;
    }
    // Fruscio di fondo: rumore bianco passa-basso, leggermente irregolare.
    n1 += 0.35 * ((rand() * 2 - 1) - n1);
    acc[t] = x + r * wet + n1 * noiseAmp;
  }
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
export function mixPcm(tracks: MixTrack[], totalMs: number, room = true): Int16Array {
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
  if (room) addRoom(acc);
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
  /** Volume della battuta rispetto al normale (1 = invariato). */
  gain?: number;
  /** Moltiplicatore della pausa prima della battuta (usato dal chiamante in `gap`). */
  gapScale?: number;
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
    let gain = t.gain ?? 1;
    const kind = i === 0 ? undefined : t.overlap;
    switch (kind) {
      case 'cut_in':
        start = Math.max(0, cursor - (150 + ((i * 37) % 110)));
        break;
      case 'reaction':
        // La reazione sta in parte sopra le ultime parole e in parte dopo: deve restare ben udibile, non "mangiata" dall'altra voce.
        start = Math.max(0, cursor - Math.min(Math.max(t.durationMs * 0.55, 180), 420));
        gain *= 0.55;
        break;
      case 'over':
        start = Math.max(0, cursor - Math.min(t.durationMs * 0.5, 900));
        gain *= 0.9;
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
