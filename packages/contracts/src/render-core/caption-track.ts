/**
 * Traccia sottotitoli attivabile dal pulsante CC del player. I sottotitoli NON sono incisi
 * nel video: si costruisce una traccia WebVTT dalle stesse righe della trascrizione (tempi
 * già allineati) e la si aggancia al <video>. È SPENTA di default, perché a fianco c'è la
 * trascrizione; serve a schermo intero, su mobile o a chi preferisce leggerla sul video.
 *
 * Senza dipendenze da React: lo usano sia l'anteprima web sia il player SCORM.
 */

export interface CaptionCue {
  start: number;
  end?: number;
  text: string;
}

function vttTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(r, 3)}`;
}

/**
 * Documento WebVTT dalle righe di trascrizione. Una riga senza fine dura fino all'inizio
 * della successiva (al massimo 6 s); le righe vuote sono scartate.
 */
export function cuesToWebVtt(cues: CaptionCue[]): string {
  const sorted = cues.filter((c) => c.text.trim()).sort((a, b) => a.start - b.start);
  const lines = ['WEBVTT', ''];
  sorted.forEach((c, i) => {
    const next = sorted[i + 1]?.start;
    let end = c.end !== undefined && c.end > c.start ? c.end : next ?? c.start + 4;
    if (next !== undefined && end > next) end = next;
    if (end - c.start > 6 && c.end === undefined) end = c.start + 6;
    // In WebVTT "-->" e righe vuote nel testo romperebbero il cue.
    const text = c.text.replace(/-->/g, '->').replace(/\s*\n\s*/g, ' ').trim();
    lines.push(String(i + 1), `${vttTime(c.start)} --> ${vttTime(Math.max(end, c.start + 0.5))}`, text, '');
  });
  return lines.join('\n');
}

/**
 * Aggancia la traccia CC al <video data-video-el> di `root`, leggendo le righe
 * `.transcript-cue` (data-seek, data-end, data-text). Idempotente: se la traccia c'è già,
 * non ne aggiunge un'altra. Ritorna una funzione che la rimuove e libera l'URL.
 */
export function attachCaptionTrack(root: HTMLElement): () => void {
  const video = root.querySelector<HTMLVideoElement>('[data-video-el]');
  if (!video || video.querySelector('track[data-caption-track]')) return () => undefined;
  const rows = Array.prototype.slice.call(root.querySelectorAll<HTMLElement>('.transcript-cue')) as HTMLElement[];
  const cues: CaptionCue[] = rows
    .map((r) => ({
      start: Number(r.getAttribute('data-seek') || '0'),
      end: r.hasAttribute('data-end') ? Number(r.getAttribute('data-end')) : undefined,
      text: r.getAttribute('data-text') || '',
    }))
    .filter((c) => Number.isFinite(c.start) && c.text.trim().length > 0);
  if (cues.length === 0 || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return () => undefined;
  }
  const url = URL.createObjectURL(new Blob([cuesToWebVtt(cues)], { type: 'text/vtt' }));
  const track = document.createElement('track');
  track.kind = 'captions';
  track.label = video.getAttribute('data-captions-label') || 'Captions';
  track.srclang = video.getAttribute('data-captions-lang') || 'en';
  track.src = url;
  track.setAttribute('data-caption-track', '');
  video.appendChild(track);
  // Spenta di default ("hidden" la rende attivabile dal pulsante CC del player).
  const off = (): void => {
    if (track.track) track.track.mode = 'hidden';
  };
  off();
  track.addEventListener('load', off, { once: true });
  return () => {
    track.remove();
    URL.revokeObjectURL(url);
  };
}
