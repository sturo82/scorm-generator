'use client';

import * as React from 'react';
import { MessageCircleQuestion, X, Search, Sparkles, BookOpen, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { buildSemanticIndex, tokenize, normalize, type SemanticIndex } from '@scorm/scorm/semantic-index';
import { useRagChunks, useRagEmbeddings } from '@/lib/api/hooks';
import type { RagChunk } from '@/lib/api/types';

/*
 * Widget "Chiedi al corso" per l'ANTEPRIMA. Replica fedelmente il widget del
 * pacchetto SCORM (runtime/rag.js): BM25 + copertura, soglia relativa, snippet
 * MIRATO (non il chunk grezzo), riferimento alla lezione per i contenuti del
 * corso. Se il browser espone l'AI integrata (window.ai) sintetizza una
 * risposta; altrimenti resta estrattivo. Stessa logica/parametri del runtime.
 */

// normalize + tokenize (con stemmer) sono importati da @scorm/scorm: la STESSA
// tokenizzazione del runtime SCORM (rag.js) e dell'indice semantico. È ciò che
// garantisce risultati IDENTICI tra anteprima e pacchetto esportato.

function splitSentences(text: string): string[] {
  const parts = String(text || '').split(/(?<=[.!?;:])\s+|\n+/);
  const out = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  return out.length ? out : [String(text || '').trim()];
}
function clip(s: string, n: number): string {
  s = String(s || '').trim();
  return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s;
}

interface Doc {
  i: number;
  len: number;
  tf: Record<string, number>;
}
function buildIndex(chunks: RagChunk[]) {
  const docs: Doc[] = chunks.map((c, i) => {
    const toks = tokenize(c.text);
    const tf: Record<string, number> = {};
    toks.forEach((t) => (tf[t] = (tf[t] || 0) + 1));
    return { i, len: toks.length, tf };
  });
  const df: Record<string, number> = {};
  docs.forEach((d) => Object.keys(d.tf).forEach((t) => (df[t] = (df[t] || 0) + 1)));
  const N = docs.length || 1;
  const avgdl = docs.reduce((s, d) => s + d.len, 0) / N || 1;
  return { docs, df, N, avgdl };
}
function bestSnippet(text: string, qtokens: string[]): string {
  const sentences = splitSentences(text);
  if (sentences.length <= 1) return clip(text, 320);
  const qset = new Set(qtokens);
  const score = (s: string) => tokenize(s).reduce((a, t) => a + (qset.has(t) ? 1 : 0), 0);
  let best = { score: -1, start: 0, size: 1 };
  for (let i = 0; i < sentences.length; i++) {
    const s1 = score(sentences[i]!);
    if (s1 > best.score) best = { score: s1, start: i, size: 1 };
    if (i + 1 < sentences.length) {
      const s2 = s1 + score(sentences[i + 1]!);
      if (s2 > best.score) best = { score: s2, start: i, size: 2 };
    }
  }
  if (best.score <= 0) return clip(text, 320);
  let snip = sentences.slice(best.start, best.start + best.size).join(' ');
  if (snip.length < 80 && best.start + best.size < sentences.length) snip += ' ' + sentences[best.start + best.size];
  return clip(snip, 360);
}

interface Hit {
  snippet: string;
  documentName: string;
  section?: string;
  ref?: RagChunk['ref'];
  score: number;
}

// --- Ricerca semantica TF-IDF cosine (IDENTICA a runtime/rag.js) ------------
// Costruisce il vettore TF-IDF L2-normalizzato della query usando vocab/idf
// dell'indice, poi cosine con i vettori sparsi dei chunk.
function queryVector(sem: SemanticIndex, qt: string[]): number[] {
  const dim = sem.idf.length;
  const vec = new Array<number>(dim).fill(0);
  const tf: Record<number, number> = {};
  for (const t of qt) {
    const col = sem.vocab[t];
    if (col !== undefined) tf[col] = (tf[col] ?? 0) + 1;
  }
  let norm = 0;
  for (const colStr of Object.keys(tf)) {
    const col = Number(colStr);
    const w = (tf[col] ?? 0) * (sem.idf[col] ?? 0);
    vec[col] = w;
    norm += w * w;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) vec[i] = vec[i]! / norm;
  return vec;
}
function cosineSparse(qDense: number[], sparse: Array<[number, number]>): number {
  let dot = 0;
  for (const [col, w] of sparse) dot += (qDense[col] ?? 0) * w;
  return dot;
}

/**
 * Ricerca IDENTICA al runtime SCORM (rag.js): BM25 + copertura, TF-IDF cosine
 * fuso 50/50 (quando l'indice semantico è disponibile), soglia assoluta di
 * copertura 30%, boost lezioni ×1.5, soglia relativa 40%, snippet, dedup.
 * Garantisce coerenza anteprima ↔ pacchetto esportato.
 */
function search(
  chunks: RagChunk[],
  index: ReturnType<typeof buildIndex>,
  semantic: SemanticIndex | null,
  query: string,
  k = 4,
): Hit[] {
  const qt = tokenize(query);
  if (qt.length === 0 || index.N === 0) return [];
  const k1 = 1.5;
  const b = 0.75;

  // BM25 per ogni chunk + copertura (serve per soglia e boost).
  const bm = new Array<number>(index.docs.length).fill(0);
  let bmMax = 0;
  let bestCoverage = 0;
  index.docs.forEach((d, di) => {
    let s = 0;
    let hit = 0;
    for (const t of qt) {
      const f = d.tf[t];
      if (!f) continue;
      hit++;
      const n = index.df[t] || 0;
      const idf = Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / index.avgdl)));
    }
    // Copertura termini: IDENTICO a bm25Score di rag.js (premia i chunk che
    // contengono più termini distinti della query).
    const cov = qt.length > 0 ? hit / qt.length : 0;
    if (s > 0 && qt.length > 0) s *= 0.5 + 0.5 * cov;
    bm[di] = s;
    if (s > bmMax) bmMax = s;
    if (cov > bestCoverage) bestCoverage = cov;
  });

  // Soglia assoluta di copertura: fuori dominio → nessun risultato.
  if (bestCoverage < 0.3) return [];

  // TF-IDF cosine (se l'indice è allineato ai chunk).
  let semScores: number[] | null = null;
  let semMax = 0;
  if (semantic && semantic.vectors.length === index.docs.length) {
    const qv = queryVector(semantic, qt);
    semScores = semantic.vectors.map((v) => cosineSparse(qv, v));
    for (const s of semScores) if (s > semMax) semMax = s;
  }

  // Punteggio combinato (BM25 norm + cosine norm, 50/50) + boost lezioni ×1.5.
  const scored: Array<{ i: number; score: number }> = [];
  for (let di = 0; di < index.docs.length; di++) {
    const bmN = bmMax > 0 ? bm[di]! / bmMax : 0;
    let combined: number;
    if (semScores) {
      // Peso maggiore al TF-IDF (termini discriminanti per IDF): stessa fusione
      // del runtime SCORM (rag.js) per coerenza anteprima ↔ pacchetto.
      const semN = semMax > 0 ? semScores[di]! / semMax : 0;
      combined = 0.35 * bmN + 0.65 * semN;
    } else {
      combined = bmN;
    }
    const ch = chunks[index.docs[di]!.i];
    if (ch?.ref?.kind === 'lesson') combined *= 1.5;
    if (combined > 0) scored.push({ i: index.docs[di]!.i, score: combined });
  }
  return formatHits(chunks, scored, qt, k);
}

/**
 * Da {i,score}[] a Hit[]: ordina, soglia relativa 40%, snippet, dedup. IDENTICO
 * a formatHits di rag.js → stesso formato/selezione in anteprima e SCORM.
 */
function formatHits(
  chunks: RagChunk[],
  scored: Array<{ i: number; score: number }>,
  qt: string[],
  k: number,
): Hit[] {
  if (scored.length === 0) return [];
  scored.sort((a, b2) => b2.score - a.score);
  const cutoff = scored[0]!.score * 0.4;
  const out: Hit[] = [];
  const seen = new Set<string>();
  for (const r of scored) {
    if (out.length >= k || r.score < cutoff) break;
    const c = chunks[r.i]!;
    const snippet = bestSnippet(c.text, qt);
    const key = normalize(snippet).slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ snippet, documentName: c.documentName, section: c.section, ref: c.ref, score: r.score });
  }
  return out;
}

// --- Ricerca NEURALE (stesso modello/codice del pacchetto SCORM) ------------
// Carica semantic-runtime.js (lo STESSO file del pacchetto) servito da /semantic
// e usa gli embeddings dei chunk pre-calcolati dal server (identici a quelli
// impacchettati). Embedda solo la query → coerenza byte-identica col SCORM.

interface SemanticRuntimeApi {
  configure(cfg: { transformersUrl: string; modelsPath: string; wasmPath: string; modelId: string }): void;
  available(): boolean;
  load(): Promise<unknown>;
  embedQuery(text: string): Promise<Float32Array>;
  decodeInt8(buffer: ArrayBuffer, dim: number): Float32Array[];
  cosine(a: Float32Array, b: Float32Array): number;
}

let _semReady: Promise<SemanticRuntimeApi | null> | null = null;

/** Carica e configura una sola volta il runtime semantico condiviso. */
function getSemanticRuntime(model: string): Promise<SemanticRuntimeApi | null> {
  if (_semReady) return _semReady;
  _semReady = (async () => {
    try {
      const g = globalThis as unknown as { SemanticRuntime?: SemanticRuntimeApi };
      if (!g.SemanticRuntime) {
        // Carica lo script vanilla condiviso (espone window.SemanticRuntime).
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script');
          s.src = '/semantic/semantic-runtime.js';
          s.onload = () => resolve();
          s.onerror = () => reject(new Error('semantic-runtime.js non caricato'));
          document.head.appendChild(s);
        });
      }
      const rt = (globalThis as unknown as { SemanticRuntime: SemanticRuntimeApi }).SemanticRuntime;
      rt.configure({
        transformersUrl: '/semantic/transformers.min.js',
        modelsPath: '/semantic/models/',
        wasmPath: '/semantic/',
        modelId: model,
      });
      return rt;
    } catch {
      return null;
    }
  })();
  return _semReady;
}

/**
 * Ricerca neurale in anteprima: embedda la query con MiniLM (stesso modello del
 * SCORM), cosine coi vettori dei chunk forniti dal server (stessi del pacchetto),
 * boost lezioni ×1.15, soglia cosine 0.25, formatHits condiviso. IDENTICA a
 * searchNeural di rag.js.
 */
async function searchNeural(
  chunks: RagChunk[],
  chunkVecs: Float32Array[],
  model: string,
  query: string,
  k = 4,
): Promise<Hit[]> {
  const rt = await getSemanticRuntime(model);
  if (!rt) throw new Error('runtime semantico non disponibile');
  if (chunkVecs.length !== chunks.length) throw new Error('embeddings non allineati');
  const qt = tokenize(query);
  const qv = await rt.embedQuery(query);
  const scored: Array<{ i: number; score: number }> = [];
  let best = 0;
  for (let i = 0; i < chunkVecs.length; i++) {
    let s = rt.cosine(qv, chunkVecs[i]!);
    if (s > best) best = s;
    const ch = chunks[i];
    if (ch?.ref?.kind === 'lesson') s *= 1.15;
    scored.push({ i, score: s });
  }
  if (best < 0.25) return [];
  return formatHits(chunks, scored, qt, k);
}

/** Accesso all'AI integrata del browser (window.ai / LanguageModel), se c'è. */
function getBrowserLM(): { kind: 'languageModel' | 'ai'; api: unknown } | null {
  const g = globalThis as unknown as { LanguageModel?: unknown; ai?: { languageModel?: unknown } };
  if (typeof g.LanguageModel !== 'undefined') return { kind: 'languageModel', api: g.LanguageModel };
  if (g.ai && g.ai.languageModel) return { kind: 'ai', api: g.ai.languageModel };
  return null;
}

/**
 * Stato dell'AI locale del browser:
 *  - 'absent'       : l'API non esiste (browser senza Prompt API).
 *  - 'unavailable'  : API presente ma modello non attivabile (es. non abilitato).
 *  - 'downloadable' : il modello va scaricato (prima volta) ma è supportato.
 *  - 'available'    : pronto all'uso.
 * Serve a mostrare un avviso mirato con le istruzioni di attivazione.
 */
type AiStatus = 'absent' | 'unavailable' | 'downloadable' | 'available' | 'unknown';

async function detectAiStatus(): Promise<AiStatus> {
  const lm = getBrowserLM();
  if (!lm) return 'absent';
  try {
    const api = lm.api as { availability?: () => Promise<string>; capabilities?: () => Promise<{ available?: string }> };
    if (api.availability) {
      const a = await api.availability();
      if (a === 'available' || a === 'readily') return 'available';
      if (a === 'downloadable' || a === 'after-download' || a === 'downloading') return 'downloadable';
      if (a === 'unavailable' || a === 'no') return 'unavailable';
      return 'unknown';
    }
    // API vecchia (ai.languageModel.capabilities).
    if (api.capabilities) {
      const c = await api.capabilities();
      if (c?.available === 'readily') return 'available';
      if (c?.available === 'after-download') return 'downloadable';
      return 'unavailable';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
/**
 * Rileva risposte di VERO rifiuto dell'AI ("il contesto non contiene...",
 * "informazioni insufficienti", ecc.). Deve essere SPECIFICA: una risposta
 * valida può contenere "non ha/non ci sono..." in senso legittimo (es. "il
 * cherry-pick non ha effetto sugli altri branch") e NON va scartata. Perciò il
 * rifiuto richiede un riferimento esplicito a contesto/informazioni/dati/
 * passaggi/materiale.
 */
function isRefusal(text: string): boolean {
  const t = normalize(text);
  const subj = '(contesto|informazion\\w*|dati|passagg\\w*|material\\w*|testo|font\\w*)';
  return (
    new RegExp(`non (fornisce|contiene|ho|ha|ci sono|trovo|sono presenti|include|riporta|menziona)[^.]{0,40}${subj}`).test(t) ||
    new RegExp(`${subj}[^.]{0,20}non (bast\\w*|sufficient\\w*|present\\w*|disponibil\\w*)`).test(t) ||
    /non (e|è)? ?possibile rispondere/.test(t) ||
    /informazioni (non|in)sufficienti/.test(t) ||
    /fuori (dal )?(contesto|tema|argomento)/.test(t)
  );
}
// Tipi minimi dell'AI del browser (Prompt API / window.ai).
interface LMSession {
  prompt: (p: string) => Promise<string>;
  promptStreaming?: (p: string) => ReadableStream<string>;
}
interface LMApi {
  create: () => Promise<LMSession>;
  availability?: () => Promise<string>;
}

// Sessione del modello riusata tra le domande: `create()` (e il primo caricamento
// del modello on-device) è costoso, rifarlo a ogni ricerca rende la risposta
// lenta. La teniamo in cache e la ricreiamo solo se diventa inutilizzabile.
let _lmSession: Promise<LMSession> | null = null;
async function getLMSession(api: LMApi): Promise<LMSession> {
  if (_lmSession) {
    try {
      return await _lmSession;
    } catch {
      _lmSession = null; // sessione fallita: ricrea sotto
    }
  }
  _lmSession = api.create();
  try {
    return await _lmSession;
  } catch (e) {
    _lmSession = null;
    throw e;
  }
}

async function generateAnswer(
  query: string,
  hits: Hit[],
  onToken?: (partial: string) => void,
): Promise<string | null> {
  const lm = getBrowserLM();
  if (!lm || hits.length === 0) return null;
  // Solo i primi 2 passaggi e troncati a 200 char → prompt più corto = risposta
  // più veloce. Sufficiente per una risposta concisa.
  const context = hits.slice(0, 2).map((h, i) => `[${i + 1}] ${(h.snippet || '').slice(0, 200)}`).join('\n');
  const prompt =
    `Rispondi alla domanda usando SOLO il contesto. Se non basta, dillo.\n\nContesto:\n${context}\n\nDomanda: ${query}\n\nRisposta concisa in italiano:`;
  try {
    const api = lm.api as LMApi;
    if (api.availability) {
      const avail = await api.availability();
      if (avail === 'unavailable') return null;
    }
    // Riusa la sessione: evita il costo di create()/caricamento modello a ogni domanda.
    let session = await getLMSession(api);
    // Streaming: la risposta appare parola per parola (più reattiva).
    // Il valore di chunk.value nella Prompt API è CUMULATIVO (tutto il testo
    // generato finora). Se lo stream si tronca prematuramente (noto con Gemini
    // Nano), full potrebbe contenere solo punteggiatura o poche parole: in quel
    // caso invalidiamo la sessione e facciamo un tentativo non-streaming.
    if (onToken && session.promptStreaming) {
      const stream = session.promptStreaming(prompt);
      const reader = stream.getReader();
      let full = '';
      let done = false;
      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        if (done) break;
        if (chunk.value !== undefined) full = chunk.value;
        onToken(full);
      }
      // Verifica: risposta sostanziale? (> 10 char alfanumerici)
      if (full.replace(/[^a-zA-Z0-9\u00C0-\u024F]/g, '').length >= 10) {
        return full;
      }
      // Stream troncato: prova con prompt() sincrono (nuova sessione).
      _lmSession = null;
      session = await getLMSession(api);
    }
    return await session.prompt(prompt);
  } catch {
    _lmSession = null; // in caso di errore, forza la ricreazione alla prossima
    return null;
  }
}

/** Decodifica gli embeddings int8 base64 (scala 127) in Float32Array per chunk. */
function decodeEmbeddingsB64(b64: string, dim: number): Float32Array[] {
  const bin = atob(b64);
  const bytes = new Int8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = (bin.charCodeAt(i) << 24) >> 24; // uint8→int8
  const count = Math.floor(bytes.length / dim);
  const out: Float32Array[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const v = new Float32Array(dim);
    for (let j = 0; j < dim; j++) v[j] = bytes[i * dim + j]! / 127;
    out[i] = v;
  }
  return out;
}

export function CourseRagWidget({ courseId, onJump }: { courseId: string; onJump?: (ref: NonNullable<RagChunk['ref']>) => void }) {
  const [open, setOpen] = React.useState(false);
  // Chunk: caricati SUBITO → il widget appare senza attendere gli embeddings.
  const chunksQuery = useRagChunks(courseId);
  const chunks = React.useMemo(() => chunksQuery.data ?? [], [chunksQuery.data]);
  // Embeddings neurali: il fetch parte appena ci sono chunk (anche a widget
  // chiuso), così la prima volta il calcolo lato server (lento) avviene in
  // background e all'apertura la ricerca neurale è già pronta o quasi. Finché
  // non sono pronti si usa il lessicale (sempre disponibile).
  const embQuery = useRagEmbeddings(courseId, chunks.length > 0);
  const index = React.useMemo(() => buildIndex(chunks), [chunks]);
  // Indice TF-IDF (fallback lessicale, identico al pacchetto SCORM).
  const semantic = React.useMemo(() => buildSemanticIndex(chunks.map((c) => c.text)), [chunks]);
  // Embeddings neurali dei chunk (STESSI del pacchetto SCORM, dal server).
  const neural = React.useMemo(() => {
    const d = embQuery.data;
    if (!d || !d.embeddingsB64) return null;
    try {
      const vecs = decodeEmbeddingsB64(d.embeddingsB64, d.dim);
      if (vecs.length !== chunks.length) return null;
      return { vecs, model: d.model };
    } catch {
      return null;
    }
  }, [embQuery.data, chunks.length]);
  // Ricerca neurale in preparazione: il fetch è in corso (prima volta il server
  // calcola gli embeddings, può durare qualche minuto) e non sono ancora
  // disponibili. Serve a mostrare un indicatore invece di lasciare l'utente nel
  // dubbio che la chat non funzioni (intanto il lessicale è già utilizzabile).
  const neuralPreparing = (embQuery.isLoading || embQuery.isFetching) && !neural;
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<Hit[] | null>(null);
  // answer: risposta FINALE confermata (non vuota, non un rifiuto). Mostrata con
  // il disclaimer. partialAnswer: testo in streaming mentre si genera (può poi
  // essere scartato se risulta un rifiuto/vuoto → niente box vuoto appeso).
  const [answer, setAnswer] = React.useState<string | null>(null);
  const [partialAnswer, setPartialAnswer] = React.useState('');
  const [answering, setAnswering] = React.useState(false);
  const [searching, setSearching] = React.useState(false);
  const [searchMode, setSearchMode] = React.useState<'neural' | 'lexical' | null>(null);
  const hasLM = React.useMemo(() => !!getBrowserLM(), []);
  // Stato reale dell'AI locale (controlla availability, non solo la presenza
  // dell'API) per avvisare l'utente e spiegare come attivarla.
  const [aiStatus, setAiStatus] = React.useState<AiStatus>('unknown');
  const [aiHelpOpen, setAiHelpOpen] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    detectAiStatus().then((s) => {
      if (alive) setAiStatus(s);
    });
    return () => {
      alive = false;
    };
  }, []);
  // Mostra l'avviso solo quando l'AI NON è pronta (presente ma inattiva, o da
  // scaricare). Se l'API non esiste proprio ('absent') restiamo silenziosi: su
  // quel browser la sintesi AI non è un'opzione e il RAG estrattivo basta.
  const aiNotReady = aiStatus === 'unavailable' || aiStatus === 'downloadable';

  if (chunks.length === 0) return null;

  function sourceLabel(h: Hit): string {
    if (h.ref && h.ref.kind === 'lesson') {
      return `Trattato in: Modulo ${h.ref.moduleIndex} › Lezione ${h.ref.lessonIndex}${h.section ? ` (${h.section})` : ''}`;
    }
    return `Fonte: ${h.documentName}${h.section ? ` — ${h.section}` : ''}`;
  }

  function runAnswer(q: string, hits: Hit[]) {
    if (hits.length > 0 && hasLM) {
      setAnswering(true);
      setPartialAnswer('');
      generateAnswer(
        q,
        hits,
        // Streaming: il testo parziale appare parola per parola (in partialAnswer,
        // separato dalla risposta finale così un eventuale rifiuto non lascia
        // testo appeso).
        (partial) => setPartialAnswer(partial),
      )
        .then((a) => {
          // Accetta solo risposte con contenuto reale e non di rifiuto: altrimenti
          // niente box AI, restano le fonti (estratti) qui sotto.
          // Soglia minima: < 10 char alfanumerici è un troncamento, non una risposta.
          const clean = (a ?? '').trim();
          const meaningful = clean.replace(/[^a-zA-Z0-9\u00C0-\u024F]/g, '').length >= 10;
          setAnswer(meaningful && !isRefusal(clean) ? clean : null);
        })
        .finally(() => {
          setAnswering(false);
          setPartialAnswer('');
        });
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    setAnswer(null);
    if (!q) {
      setResults(null);
      return;
    }
    // Ricerca NEURALE (primaria, stesso modello/embeddings del SCORM) con
    // fallback lessicale. Identica a rag.js → coerenza anteprima↔pacchetto.
    if (neural) {
      setSearching(true);
      try {
        const hits = await searchNeural(chunks, neural.vecs, neural.model, q, 4);
        setResults(hits);
        setSearching(false);
        setSearchMode('neural');
        runAnswer(q, hits);
        return;
      } catch {
        // fallback lessicale sotto
      }
      setSearching(false);
    }
    const hits = search(chunks, index, semantic, q, 4);
    setResults(hits);
    setSearchMode('lexical');
    runAnswer(q, hits);
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={neuralPreparing ? 'Chiedi al corso — preparazione ricerca intelligente…' : 'Chiedi al corso'}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-float transition-transform hover:-translate-y-0.5"
        >
          <MessageCircleQuestion className="size-4" /> Chiedi al corso
          {/* Pallino pulsante: segnala che la ricerca neurale si sta preparando
              in background (prima volta). Senza, l'utente non sa che sta arrivando. */}
          {neuralPreparing && (
            <span className="relative flex size-2.5" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary-foreground/70" />
              <span className="relative inline-flex size-2.5 rounded-full bg-primary-foreground" />
            </span>
          )}
        </button>
      )}
      {open && (
        <div
          role="dialog"
          aria-label="Chiedi al corso"
          className="fixed bottom-5 right-5 z-40 flex max-h-[min(560px,calc(100vh-2.5rem))] w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border bg-card shadow-float"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="font-bold">Chiedi al corso</span>
            <button type="button" aria-label="Chiudi" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
          <form onSubmit={onSubmit} className="flex gap-2 px-4 py-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Fai una domanda sul corso…"
                aria-label="Domanda"
                className="w-full rounded-lg border bg-background py-2 pl-8 pr-2 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>
            <button type="submit" className="rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground">
              Cerca
            </button>
          </form>
          <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-2">
            {/* Avviso AI locale non pronta: la ricerca funziona comunque, ma la
                SINTESI della risposta richiede l'AI on-device del browser. Qui
                spieghiamo come attivarla (Chrome) per prestazioni migliori. */}
            {aiNotReady && (
              <div className="rounded-xl border border-warning/40 bg-warning/5 px-3 py-2.5 text-xs">
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-warning" />
                  <div className="space-y-1 leading-relaxed">
                    <p className="font-semibold text-foreground">
                      {aiStatus === 'downloadable'
                        ? 'Risposte AI non ancora pronte'
                        : 'Risposte AI non attive'}
                    </p>
                    <p className="text-muted-foreground">
                      {aiStatus === 'downloadable'
                        ? 'Il modello AI del browser è supportato ma va scaricato. Nel frattempo trovi gli estratti dal corso qui sotto.'
                        : "L'AI locale del browser non è attiva: vedi gli estratti dal corso qui sotto. Attivala per avere risposte sintetizzate."}
                    </p>
                    <button
                      type="button"
                      onClick={() => setAiHelpOpen((v) => !v)}
                      className="font-semibold text-primary hover:underline"
                      aria-expanded={aiHelpOpen}
                    >
                      {aiHelpOpen ? 'Nascondi istruzioni' : 'Come attivarla su Chrome →'}
                    </button>
                    {aiHelpOpen && (
                      <ol className="mt-1 list-decimal space-y-1 pl-4 text-muted-foreground">
                        <li>Usa Chrome desktop 128+ (serve ~22 GB liberi e una GPU idonea).</li>
                        <li>
                          Apri{' '}
                          <code className="rounded bg-muted px-1 py-0.5 text-[10px]">chrome://flags/#prompt-api-for-gemini-nano</code>{' '}
                          → <span className="font-semibold">Enabled</span>.
                        </li>
                        <li>
                          Apri{' '}
                          <code className="rounded bg-muted px-1 py-0.5 text-[10px]">chrome://flags/#optimization-guide-on-device-model</code>{' '}
                          → <span className="font-semibold">Enabled BypassPerfRequirement</span>.
                        </li>
                        <li>Riavvia Chrome.</li>
                        <li>
                          In{' '}
                          <code className="rounded bg-muted px-1 py-0.5 text-[10px]">chrome://components</code>{' '}
                          cerca «Optimization Guide On Device Model» → «Check for update» (scarica il modello).
                        </li>
                        <li>Quando mostra una versione, ricarica questa pagina.</li>
                      </ol>
                    )}
                  </div>
                </div>
              </div>
            )}
            {/* Preparazione ricerca neurale (prima volta: il server calcola gli
                embeddings, può durare qualche minuto). Si chiarisce che la chat
                è GIÀ usabile in modalità base intanto. */}
            {neuralPreparing && (
              <div
                className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs"
                aria-live="polite"
              >
                <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" />
                <span className="leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">Preparazione ricerca intelligente…</span>{' '}
                  La prima volta richiede qualche istante. Puoi già fare domande: la ricerca passa
                  automaticamente alla modalità neurale appena è pronta.
                </span>
              </div>
            )}
            {/* Ricerca neurale in corso (carico modello / embeddo query). */}
            {searching && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                <span>Cerco nei contenuti del corso</span>
                <TypingDots />
              </div>
            )}
            {/* RISPOSTA AI — sintetizzata dal modello, chiaramente etichettata e
                distinta dalle fonti. Durante la generazione mostra lo stato +
                l'eventuale testo in streaming; a fine resta solo se c'è una
                risposta reale (non vuota, non di rifiuto) — altrimenti niente
                box vuoto, restano le fonti qui sotto. */}
            {!searching && (answering || answer) && (
              <section
                aria-label="Risposta generata dall'AI"
                className="overflow-hidden rounded-xl border border-primary/40 bg-primary/5"
              >
                <div className="flex items-center gap-1.5 border-b border-primary/20 bg-primary/10 px-3 py-1.5">
                  <Sparkles className="size-3.5 text-primary" />
                  <span className="text-xs font-bold uppercase tracking-wide text-primary">Risposta AI</span>
                </div>
                <div className="p-3">
                  {answering ? (
                    partialAnswer ? (
                      // Testo in arrivo (streaming): lo mostriamo man mano.
                      <p className="text-sm leading-relaxed" aria-live="polite">
                        {partialAnswer}
                        <span className="ml-0.5 inline-block animate-pulse">▍</span>
                      </p>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                        <span>Sto formulando una risposta</span>
                        <TypingDots />
                      </div>
                    )
                  ) : (
                    <>
                      <p className="text-sm leading-relaxed">{answer}</p>
                      <p className="mt-2 text-[11px] italic text-muted-foreground">
                        Generata dall’AI del browser dai passaggi qui sotto. Verifica sulle fonti.
                      </p>
                    </>
                  )}
                </div>
              </section>
            )}

            {/* FONTI — estratti letterali dai materiali del corso, con link alle
                lezioni. Sezione separata e visivamente distinta dalla risposta AI. */}
            {searching ? null : results === null ? null : results.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessun passaggio pertinente trovato nei materiali del corso.</p>
            ) : (
              <section aria-label="Fonti dal corso" className="space-y-2">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <BookOpen className="size-3.5" />
                  <span className="text-[11px] font-bold uppercase tracking-wide">
                    {answer ? 'Fonti · estratti dal corso' : 'Estratti dal corso'}
                  </span>
                </div>
                {results.map((h, i) => (
                  <div key={i} className="rounded-xl border bg-background p-3">
                    <p className="mb-1.5 text-sm leading-relaxed">{h.snippet}</p>
                    {h.ref && h.ref.kind === 'lesson' && onJump ? (
                      <button
                        type="button"
                        onClick={() => { setOpen(false); onJump(h.ref!); }}
                        className="m-0 inline-flex items-center gap-1 text-left text-xs font-semibold text-primary hover:underline"
                      >
                        {sourceLabel(h)} →
                      </button>
                    ) : (
                      <p className="m-0 text-xs font-medium text-muted-foreground">{sourceLabel(h)}</p>
                    )}
                  </div>
                ))}
              </section>
            )}
          </div>
          <div className="flex items-center gap-2 border-t px-4 py-2.5">
            {searchMode && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                  searchMode === 'neural'
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                <span
                  className={cn('size-1.5 rounded-full', searchMode === 'neural' ? 'bg-primary' : 'bg-muted-foreground')}
                />
                {searchMode === 'neural' ? 'Neurale' : 'Lessicale'}
              </span>
            )}
            <span className="flex-1 text-[11px] text-muted-foreground">
              {hasLM ? 'AI locale · fonti dal corso' : 'Estratti dai materiali'}
            </span>
          </div>
        </div>
      )}
    </>
  );
}

/** Tre puntini pulsanti animati: indicatore "sta pensando" (typing). */
function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden="true">
      <span className="size-1.5 rounded-full bg-primary animate-typing-dot" />
      <span className="size-1.5 rounded-full bg-primary animate-typing-dot [animation-delay:0.18s]" />
      <span className="size-1.5 rounded-full bg-primary animate-typing-dot [animation-delay:0.36s]" />
    </span>
  );
}
