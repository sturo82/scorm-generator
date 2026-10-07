/*
 * render-core/video.ts — Helper condivisi per i media video: URL di embed dei
 * provider esterni (YouTube/Vimeo/Twitch) e formattazione del tempo. Prima
 * queste funzioni erano duplicate (regex incluse) nel renderer web e in quello
 * SCORM; ora c'è una sola implementazione.
 */

import type { MediaRef } from '../primitives.js';

/** Cue di trascrizione sincronizzata (karaoke). */
export interface TranscriptCueLike {
  id?: string;
  start: number;
  end?: number;
  speaker?: string;
  text: string;
}

/**
 * URL di embed per i provider esterni. Ritorna null se la sorgente non è
 * esterna o non è riconosciuta. `parentHost` serve a Twitch (richiede il
 * dominio dell'embedder); in ambienti senza window usare 'localhost'.
 */
export function videoEmbedUrl(video: Partial<MediaRef>, parentHost?: string): string | null {
  const src = video.source;
  const id = video.externalId || '';
  const url = video.externalUrl || '';
  if (src === 'youtube') {
    const yv =
      id ||
      (url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([\w-]{11})/) || [])[1];
    return yv ? 'https://www.youtube.com/embed/' + yv + '?rel=0' : null;
  }
  if (src === 'vimeo') {
    const vv = id || (url.match(/vimeo\.com\/(?:video\/)?(\d+)/) || [])[1];
    return vv ? 'https://player.vimeo.com/video/' + vv : null;
  }
  if (src === 'twitch') {
    const tv = id || (url.match(/twitch\.tv\/videos\/(\d+)/) || [])[1];
    const parent = parentHost || 'localhost';
    return tv ? 'https://player.twitch.tv/?video=' + tv + '&parent=' + parent : null;
  }
  return null;
}

/** Secondi → "m:ss". */
export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' + sec : String(sec));
}

/** Ordina le cue per tempo di inizio crescente (il karaoke lo assume). */
export function sortCues<T extends TranscriptCueLike>(cues: T[]): T[] {
  return [...cues].sort((a, b) => a.start - b.start);
}
