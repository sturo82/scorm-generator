import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';

/**
 * Embedder semantico SERVER-SIDE per il RAG neurale offline. Calcola gli
 * embedding dei chunk all'export/anteprima usando ESATTAMENTE lo stesso modello
 * (Xenova/all-MiniLM-L6-v2 quantizzato) e lo stesso runtime (@xenova/transformers
 * su WASM/ONNX) che gira poi nel browser. Stesso modello → vettori identici →
 * ranking IDENTICO ovunque.
 *
 * Il calcolo gira in un WORKER THREAD, così il carico ONNX/WASM (CPU-bound,
 * single-thread) NON blocca l'event loop di Node: l'API resta reattiva durante
 * export e anteprima. Il modello è vendorato (nessuna rete).
 */

const here = dirname(fileURLToPath(import.meta.url));
// dist/package/semantic-embedder.js → ../../runtime/assets/semantic
const SEMANTIC_DIR = join(here, '..', 'runtime', 'assets', 'semantic');
const WORKER_PATH = join(here, 'semantic-worker.js');

/** Modello di embedding (deve combaciare con la cartella vendorata). */
export const EMBED_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
/** Dimensione dei vettori prodotti dal modello. */
export const EMBED_DIM = 384;

interface Pending {
  resolve: (v: number[][]) => void;
  reject: (e: Error) => void;
}

let _worker: Worker | null = null;
let _seq = 0;
const _pending = new Map<number, Pending>();

/** Avvia (una volta) il worker di embedding. Null se non avviabile. */
function getWorker(): Worker | null {
  if (_worker) return _worker;
  try {
    _worker = new Worker(WORKER_PATH);
    _worker.on('message', (msg: { id: number; ok: boolean; vectors?: number[][]; error?: string }) => {
      const p = _pending.get(msg.id);
      if (!p) return;
      _pending.delete(msg.id);
      if (msg.ok && msg.vectors) p.resolve(msg.vectors);
      else p.reject(new Error(msg.error || 'embedding worker error'));
    });
    _worker.on('error', (err) => {
      // Fallisce tutte le richieste pendenti; il worker verrà ricreato.
      for (const [, p] of _pending) p.reject(err);
      _pending.clear();
      _worker = null;
    });
    _worker.on('exit', () => {
      _worker = null;
    });
    // Non tiene vivo il processo se è l'unica cosa in esecuzione.
    _worker.unref();
    return _worker;
  } catch {
    _worker = null;
    return null;
  }
}

/**
 * Calcola gli embedding (mean-pooling + L2-normalize) per una lista di testi,
 * delegando a un worker thread. Ritorna number[][] di lunghezza EMBED_DIM, nello
 * stesso ordine dei testi.
 */
export function embedTexts(texts: string[], batchSize = 32): Promise<number[][]> {
  if (texts.length === 0) return Promise.resolve([]);
  const worker = getWorker();
  if (!worker) return Promise.reject(new Error('embedding worker non disponibile'));
  const id = ++_seq;
  // La richiesta mantiene vivo il worker finché non risponde.
  worker.ref();
  return new Promise<number[][]>((resolve, reject) => {
    _pending.set(id, {
      resolve: (v) => {
        if (_pending.size === 0 && _worker) _worker.unref();
        resolve(v);
      },
      reject: (e) => {
        if (_pending.size === 0 && _worker) _worker.unref();
        reject(e);
      },
    });
    worker.postMessage({ id, texts, batchSize });
  });
}

/** Indica se gli asset del modello sono vendorati (altrimenti si salta il RAG neurale). */
export function semanticAssetsDir(): string {
  return SEMANTIC_DIR;
}
