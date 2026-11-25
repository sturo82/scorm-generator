import type { PodcastEpisodeState } from '@scorm/contracts';

export const PODCAST_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'it', label: 'Italiano' },
  { code: 'en', label: 'Inglese' },
  { code: 'es', label: 'Spagnolo' },
  { code: 'fr', label: 'Francese' },
  { code: 'de', label: 'Tedesco' },
  { code: 'pt', label: 'Portoghese' },
];

export const EPISODE_STATE: Record<PodcastEpisodeState, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' }> = {
  DRAFT: { label: 'Da scrivere', variant: 'secondary' },
  WRITING: { label: 'In scrittura…', variant: 'warning' },
  SCRIPT_READY: { label: 'Copione pronto', variant: 'default' },
  VOICING: { label: 'In registrazione…', variant: 'warning' },
  READY: { label: 'Audio pronto', variant: 'success' },
  FAILED: { label: 'Errore', variant: 'destructive' },
};

/** Messaggio leggibile da un errore dell'API ("API 400: {...message...}"). */
export function errText(e: unknown, fallback = 'Operazione non riuscita'): string {
  const raw = e instanceof Error ? e.message : '';
  const m = /"message"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(raw);
  const text = (m ? m[1]!.replace(/\\"/g, '"') : raw.replace(/^API \d+:\s*/, '')).trim();
  return text.slice(0, 300) || fallback;
}

/** 125 -> "2:05" ; 3725 -> "1:02:05". */
export function fmtDuration(sec?: number): string {
  if (!sec || sec <= 0) return '–';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Scarica un testo come file dal browser. */
export function downloadText(filename: string, contentType: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: contentType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
