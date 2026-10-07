import { parentPort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Worker thread per il calcolo degli embedding. Isola il carico ONNX/WASM
 * (single-thread, CPU-bound) dal thread principale di Node, così l'API resta
 * reattiva durante export e anteprima. Usa lo STESSO modello vendorato del
 * runtime browser → vettori identici.
 *
 * Protocollo messaggi:
 *   in : { id, texts: string[], batchSize?: number }
 *   out: { id, ok: true, vectors: number[][] } | { id, ok: false, error: string }
 */

const here = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(here, '..', 'runtime', 'assets', 'semantic', 'models');
const EMBED_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _extractor: Promise<any> | null = null;

function getExtractor(): Promise<unknown> {
  if (_extractor) return _extractor;
  _extractor = (async () => {
    const transformers = await import('@xenova/transformers');
    const { pipeline, env } = transformers as unknown as {
      pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<unknown>;
      env: {
        allowRemoteModels: boolean;
        localModelPath: string;
        backends: { onnx: { wasm: { numThreads: number } } };
      };
    };
    env.allowRemoteModels = false;
    env.localModelPath = MODELS_DIR;
    env.backends.onnx.wasm.numThreads = 1;
    return pipeline('feature-extraction', EMBED_MODEL_ID, { quantized: true });
  })();
  return _extractor;
}

interface InMsg {
  id: number;
  texts: string[];
  batchSize?: number;
}

parentPort?.on('message', async (msg: InMsg) => {
  const { id, texts, batchSize = 32 } = msg;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extractor = (await getExtractor()) as any;
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize).map((t) => (t && t.length > 0 ? t : ' '));
      const res = await extractor(batch, { pooling: 'mean', normalize: true });
      const list = res.tolist() as number[][];
      for (const v of list) vectors.push(v);
    }
    parentPort?.postMessage({ id, ok: true, vectors });
  } catch (err) {
    parentPort?.postMessage({ id, ok: false, error: err instanceof Error ? err.message : 'errore' });
  }
});
