/*
 * lesson-provenance.ts — "Impronta di generazione" dei contenuti di una lezione.
 *
 * Problema: dopo che i contenuti di una lezione sono stati generati, alcuni
 * INPUT da cui dipendono possono cambiare (formato, obiettivi, taglio del corso,
 * tono, documenti di knowledge usati come fonte, versione del prompt). Quando
 * cambiano, i contenuti salvati sono OBSOLETI e vanno rigenerati.
 *
 * Invece di indovinarlo con euristiche sui block, registriamo al momento della
 * generazione un HASH stabile degli input che determinano i contenuti
 * (`lessonContentInputHash`). Confrontando l'hash salvato con quello corrente si
 * stabilisce — come FATTO, non euristica — se la lezione è "da rigenerare"
 * (`lessonContentStale`). Stesso principio del contentHash della cache RAG.
 *
 * L'hash è DETERMINISTICO e indipendente dall'ordine degli array (obiettivi,
 * documenti), così riordini innocui non producono falsi "obsoleto". Funzione
 * pura, senza dipendenze da Node: usabile in API e browser.
 */

/**
 * Versione della LOGICA DI GENERAZIONE (prompt/struttura dei contenuti). Va
 * incrementata quando un cambiamento al modo in cui si generano i contenuti
 * deve marcare obsolete le lezioni già prodotte (così l'autore sa di poter
 * rigenerare per beneficiare del miglioramento). È parte dell'impronta.
 */
export const LESSON_CONTENT_PROMPT_VERSION = 1;

/** Input che determinano i contenuti di una lezione (impronta di generazione). */
export interface LessonContentInputs {
  /** Formato didattico effettivo della lezione (pillola/video_first/standard/…). */
  format: string;
  /** Obiettivi della lezione. */
  objectives: string[];
  /** Taglio/scope del corso (brief.courseFocus). */
  courseFocus?: string | null;
  /** Tono di voce (brief.tone). */
  tone?: string | null;
  /** Documenti knowledge usati come fonte RAG (brief.knowledgeDocIds). */
  knowledgeDocIds?: string[];
}

/** Normalizza una stringa per l'hash: trim + collasso spazi. Vuoto → ''. */
function norm(s: string | null | undefined): string {
  return (s ?? '').trim().replace(/\s+/g, ' ');
}

/** Normalizza un array di stringhe: trim, scarta vuoti, ORDINA (ordine-agnostico). */
function normArray(arr: string[] | undefined): string[] {
  return (arr ?? []).map((x) => norm(x)).filter((x) => x.length > 0).sort();
}

/**
 * Hash FNV-1a a 64 bit (in esadecimale) di una stringa. Deterministico, senza
 * dipendenze: adatto a un'impronta leggera (non crittografica). Collisioni
 * trascurabili per questo uso (confronto uguale/diverso).
 */
function fnv1a(str: string): string {
  // Due metà a 32 bit per simulare 64 bit senza BigInt in hot path.
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 ^= c & 0xff;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= (c >> 8) & 0xff;
    h2 = Math.imul(h2, 0x01000193);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2);
}

/**
 * Calcola l'impronta di generazione dei contenuti di una lezione. Stabile e
 * indipendente dall'ordine di obiettivi/documenti; include la versione del
 * prompt così un bump marca obsolete le lezioni esistenti.
 */
export function lessonContentInputHash(input: LessonContentInputs): string {
  const canonical = JSON.stringify({
    v: LESSON_CONTENT_PROMPT_VERSION,
    format: norm(input.format),
    objectives: normArray(input.objectives),
    courseFocus: norm(input.courseFocus),
    tone: norm(input.tone),
    knowledgeDocIds: normArray(input.knowledgeDocIds),
  });
  return fnv1a(canonical);
}

/**
 * True se i contenuti di una lezione sono OBSOLETI rispetto agli input correnti.
 *  - `savedHash` assente/null (es. corsi storici o mai generati) → NON obsoleto:
 *    stato "ignoto", non vogliamo falsi allarmi su contenuti pre-impronta.
 *  - altrimenti obsoleto sse l'hash salvato differisce da quello corrente.
 */
export function lessonContentStale(savedHash: string | null | undefined, currentHash: string): boolean {
  if (!savedHash) return false;
  return savedHash !== currentHash;
}
