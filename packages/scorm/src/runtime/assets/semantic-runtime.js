/*
 * semantic-runtime.js — Caricatore del modello di embedding neurale (MiniLM via
 * Transformers.js su WASM) per il RAG offline. CONDIVISO tra il pacchetto SCORM
 * (rag.js) e l'anteprima web (course-rag-widget): stesso identico codice e
 * stesso modello → la query produce lo STESSO vettore ovunque → ranking
 * identico. Nessuna rete: modello e runtime sono locali.
 *
 * API (window.SemanticRuntime):
 *   configure({ transformersUrl, modelsPath, wasmPath, modelId })
 *   available() -> bool            (true se è stato configurato un modello)
 *   embedQuery(text) -> Promise<Float32Array(384)>   (mean-pool + L2 normalize)
 *   decodeInt8(buffer, dim) -> Array<Float32Array>   (de-quantizza gli embeddings)
 *   cosine(a, b) -> number
 *   load() -> Promise<void>        (carica/riscalda il modello; errori propagati)
 */
(function (global) {
  'use strict';

  var _cfg = null; // { transformersUrl, modelsPath, wasmPath, modelId }
  var _extractorPromise = null;

  function configure(cfg) {
    _cfg = cfg || null;
  }

  function available() {
    return !!(_cfg && _cfg.transformersUrl && _cfg.modelsPath && _cfg.modelId);
  }

  /** Carica (una volta) la pipeline di feature-extraction dal modello locale. */
  function load() {
    if (_extractorPromise) return _extractorPromise;
    if (!available()) return Promise.reject(new Error('semantic runtime non configurato'));
    _extractorPromise = (async function () {
      // import() dinamico dell'ESM di Transformers.js (vendorato nel pacchetto).
      var T = await import(_cfg.transformersUrl);
      var pipeline = T.pipeline;
      var env = T.env;
      env.allowRemoteModels = false;
      env.localModelPath = _cfg.modelsPath;
      if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
        env.backends.onnx.wasm.wasmPaths = _cfg.wasmPath;
        env.backends.onnx.wasm.numThreads = 1;
      }
      return pipeline('feature-extraction', _cfg.modelId, { quantized: true });
    })();
    return _extractorPromise;
  }

  /** Embedding della query: mean-pooling + L2-normalize, come i chunk all'export. */
  async function embedQuery(text) {
    var extractor = await load();
    var out = await extractor([String(text || ' ')], { pooling: 'mean', normalize: true });
    var data = out.data || (out.tolist ? out.tolist()[0] : null);
    // out.data è un Float32Array piatto [1 x dim]; prendi i primi dim valori.
    var dim = (out.dims && out.dims[out.dims.length - 1]) || data.length;
    var v = new Float32Array(dim);
    for (var i = 0; i < dim; i++) v[i] = data[i];
    return v;
  }

  /** De-quantizza gli embeddings int8 (scala 127) in un array di Float32Array. */
  function decodeInt8(buffer, dim) {
    var i8 = new Int8Array(buffer);
    var count = Math.floor(i8.length / dim);
    var out = new Array(count);
    for (var i = 0; i < count; i++) {
      var v = new Float32Array(dim);
      var base = i * dim;
      for (var j = 0; j < dim; j++) v[j] = i8[base + j] / 127;
      out[i] = v;
    }
    return out;
  }

  /** Cosine tra due vettori (gli embeddings sono ~L2-normalizzati → ≈ dot). */
  function cosine(a, b) {
    var dot = 0, na = 0, nb = 0;
    var n = Math.min(a.length, b.length);
    for (var i = 0; i < n; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  global.SemanticRuntime = {
    configure: configure,
    available: available,
    load: load,
    embedQuery: embedQuery,
    decodeInt8: decodeInt8,
    cosine: cosine,
  };
})(typeof window !== 'undefined' ? window : this);
