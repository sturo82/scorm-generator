/**
 * Indice semantico TF-IDF per il RAG offline (opzionale, Blocco "ricerca
 * semantica"). Calcolato server-side all'export e serializzato nel pacchetto;
 * il runtime (rag.js) lo usa per una ricerca a cosine similarity, con fallback
 * su BM25 lessicale quando l'indice non è presente.
 *
 * Scelta progettuale: niente modello WASM da ~30MB impacchettato. L'indice
 * TF-IDF pesa pochi KB, è self-contained e offline, e migliora il matching
 * rispetto al solo BM25 catturando l'importanza dei termini a livello di
 * documento. La tokenizzazione DEVE restare identica a quella di rag.js.
 */

/** Stopword IT/EN: stessa lista del runtime (rag.js) per coerenza. */
const STOPWORDS = new Set([
  'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'di', 'a', 'da', 'in',
  'con', 'su', 'per', 'tra', 'fra', 'e', 'ed', 'o', 'ma', 'che', 'chi', 'cui',
  'non', 'come', 'cosa', 'è', 'sono', 'si', 'del', 'della', 'dei', 'delle', 'al',
  'allo', 'alla', 'ai', 'agli', 'alle', 'nel', 'nella', 'dal', 'sul', 'piu',
  'più', 'quando', 'dove', 'quale', 'the', 'of', 'and', 'to', 'is', 'are', 'an',
  'for', 'on', 'with', 'as', 'by', 'at', 'be', 'this', 'that', 'it', 'what',
  'how', 'when', 'where', 'which', 'who', 'why',
]);

export function normalize(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0300-\u036f]/g, '');
}

// Suffissi (dal più lungo al più corto): IDENTICO a rag.js (STEM_SUFFIXES).
const STEM_SUFFIXES = [
  'azioni', 'azione', 'amento', 'imento', 'arono', 'erono', 'irono',
  'zione', 'mente', 'ando', 'endo', 'ismo', 'ista', 'ità',
  'are', 'ere', 'ire', 'ato', 'ata', 'ati', 'ate', 'uto', 'uta', 'uti', 'ute',
  'ito', 'ita', 'iti', 'ite', 'ano', 'ono', 'oso', 'osa',
  'tion', 'ting', 'ing', 'ers', 'ed',
  'a', 'e', 'i', 'o',
];
/** Stemmer leggero IT/EN: riduce le varianti morfologiche a una radice comune. */
export function stem(t: string): string {
  if (t.length <= 3) return t;
  for (const suf of STEM_SUFFIXES) {
    if (t.length - suf.length >= 3 && t.slice(-suf.length) === suf) {
      return t.slice(0, t.length - suf.length);
    }
  }
  return t;
}

export function tokenize(s: string): string[] {
  return normalize(s)
    .replace(/[^a-z0-9àèéìòùç\s]/gi, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .map(stem);
}

/**
 * Indice semantico serializzabile:
 *  - vocab: termine -> colonna del vettore
 *  - idf:   peso IDF per colonna (stesso ordine di vocab)
 *  - vectors: per ogni chunk, vettore sparso TF-IDF L2-normalizzato come
 *    coppie [colonna, peso] (sparso per contenere la dimensione).
 */
export interface SemanticIndex {
  vocab: Record<string, number>;
  idf: number[];
  vectors: Array<Array<[number, number]>>;
}

/**
 * Costruisce l'indice TF-IDF dai testi dei chunk (stesso ordine). Ritorna null
 * se non ci sono abbastanza dati per un indice utile.
 */
export function buildSemanticIndex(texts: string[]): SemanticIndex | null {
  if (!texts || texts.length === 0) return null;

  const docsTokens = texts.map(tokenize);
  const N = docsTokens.length;

  // Document frequency per termine.
  const df: Record<string, number> = {};
  for (const toks of docsTokens) {
    const seen = new Set<string>();
    for (const t of toks) {
      if (!seen.has(t)) {
        seen.add(t);
        df[t] = (df[t] || 0) + 1;
      }
    }
  }

  // Vocabolario: tutti i termini osservati; colonne stabili.
  const terms = Object.keys(df);
  if (terms.length === 0) return null;
  const vocab: Record<string, number> = {};
  const idf: number[] = [];
  terms.forEach((t, col) => {
    vocab[t] = col;
    // IDF smussato (coerente con una ricerca a cosine su TF-IDF).
    idf.push(Math.log((N + 1) / ((df[t] ?? 0) + 1)) + 1);
  });

  // Vettori TF-IDF sparsi, L2-normalizzati.
  const vectors: Array<Array<[number, number]>> = docsTokens.map((toks) => {
    const tf: Record<number, number> = {};
    for (const t of toks) {
      const col = vocab[t];
      if (col === undefined) continue;
      tf[col] = (tf[col] || 0) + 1;
    }
    const entries: Array<[number, number]> = [];
    let norm = 0;
    for (const colStr of Object.keys(tf)) {
      const col = Number(colStr);
      const w = (tf[col] ?? 0) * (idf[col] ?? 0);
      entries.push([col, w]);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const e of entries) e[1] = e[1] / norm;
    return entries;
  });

  // Arrotonda i pesi per contenere la dimensione del JSON (precisione sufficiente
  // per il ranking a cosine).
  for (const vec of vectors) for (const e of vec) e[1] = Math.round(e[1] * 10000) / 10000;
  const idfRounded = idf.map((v) => Math.round(v * 10000) / 10000);

  return { vocab, idf: idfRounded, vectors };
}
