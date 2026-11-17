import type { PronunciationEntry } from '@scorm/contracts';

/**
 * Glossario di pronuncia. La sintesi vocale legge ogni parola con le regole della lingua del
 * copione: nomi propri, marchi e sigle stranieri escono storpiati. Prima di inviare il testo alla
 * voce si sostituisce ogni termine con la sua scrittura fonetica; i sottotitoli (che HeyGen
 * ricava dal testo inviato) si riportano poi alla scrittura originale, così a schermo e nella
 * trascrizione resta sempre il termine corretto.
 */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Parola intera (anche con lettere accentate), senza distinguere maiuscole e minuscole. */
function wordRegex(word: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, 'giu');
}

/** Voci utilizzabili: termine e pronuncia non vuoti e diversi tra loro. */
export function usableGlossary(glossary: PronunciationEntry[] | undefined): PronunciationEntry[] {
  return (glossary ?? [])
    .map((e) => ({ term: e.term.trim(), spoken: e.spoken.trim() }))
    .filter((e) => e.term && e.spoken && e.term.toLowerCase() !== e.spoken.toLowerCase())
    .sort((a, b) => b.term.length - a.term.length);
}

/** Testo da far leggere alla voce. */
export function applyGlossary(text: string, glossary: PronunciationEntry[] | undefined): string {
  let out = text;
  for (const e of usableGlossary(glossary)) out = out.replace(wordRegex(e.term), () => e.spoken);
  return out;
}

/** Riporta ai termini originali la pronuncia fonetica trovata nei sottotitoli. */
export function restoreGlossary(text: string, glossary: PronunciationEntry[] | undefined): string {
  let out = text;
  for (const e of [...usableGlossary(glossary)].sort((a, b) => b.spoken.length - a.spoken.length)) {
    out = out.replace(wordRegex(e.spoken), () => e.term);
  }
  return out;
}
