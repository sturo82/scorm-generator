/*
 * rag.js — Widget "Chiedi al corso" (RAG offline, client-side).
 *
 * Interroga la knowledge del corso SENZA rete: ricerca lessicale BM25 sui chunk
 * pre-impacchettati in window.__RAG__ (testo + citazione). È estrattivo e
 * MIRATO: non mostra il chunk grezzo, ma lo snippet (la frase/finestra) più
 * pertinente alla domanda, con la fonte e — per i contenuti del corso — la
 * lezione in cui l'argomento è trattato. Applica una soglia relativa: se nessun
 * passaggio è abbastanza pertinente, risponde "non trovato" invece di mostrare
 * sempre i soliti chunk (evita risposte uguali a domande diverse).
 *
 * Se il browser espone l'AI integrata (window.ai / LanguageModel, es. Chrome),
 * sintetizza una risposta discorsiva dai passaggi trovati; altrimenti resta
 * estrattivo. Nessun download, nessun modello impacchettato per questa parte.
 *
 * window.CourseRag:
 *   - search(query, chunks?, k?) -> [{ text, snippet, documentName, section, score, ref }]
 *   - mount(root?, chunks?, options?) -> monta il widget flottante
 */
(function (global) {
  'use strict';

  var STOPWORDS = {
    il: 1, lo: 1, la: 1, i: 1, gli: 1, le: 1, un: 1, uno: 1, una: 1, di: 1, a: 1,
    da: 1, in: 1, con: 1, su: 1, per: 1, tra: 1, fra: 1, e: 1, ed: 1, o: 1, ma: 1,
    che: 1, chi: 1, cui: 1, non: 1, come: 1, cosa: 1, è: 1, sono: 1, si: 1, del: 1,
    della: 1, dei: 1, delle: 1, al: 1, allo: 1, alla: 1, ai: 1, agli: 1, alle: 1,
    nel: 1, nella: 1, dal: 1, sul: 1, piu: 1, 'più': 1, quando: 1, dove: 1, quale: 1,
    the: 1, of: 1, and: 1, to: 1, is: 1, are: 1, an: 1, for: 1, on: 1,
    'with': 1, as: 1, by: 1, at: 1, be: 1, 'this': 1, that: 1, 'it': 1, what: 1, how: 1,
    'when': 1, 'where': 1, 'which': 1, who: 1, why: 1,
  };

  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  /**
   * Stemmer leggero IT/EN: riduce le varianti morfologiche a una radice comune
   * (es. crea/creare/creazione/creato → "cre") così la ricerca lessicale
   * matcha forme diverse della stessa parola. Deterministico e IDENTICO lato
   * anteprima (semantic-index.ts): è la chiave della coerenza + pertinenza.
   */
  // Suffissi (dal più lungo al più corto): verbali/nominali/aggettivali IT + EN.
  // La radice minima è 3 caratteri (evita over-stemming). IDENTICO a
  // semantic-index.ts (STEM_SUFFIXES) per coerenza anteprima ↔ pacchetto.
  var STEM_SUFFIXES = [
    'azioni', 'azione', 'amento', 'imento', 'arono', 'erono', 'irono',
    'zione', 'mente', 'ando', 'endo', 'ismo', 'ista', 'ità',
    'are', 'ere', 'ire', 'ato', 'ata', 'ati', 'ate', 'uto', 'uta', 'uti', 'ute',
    'ito', 'ita', 'iti', 'ite', 'ano', 'ono', 'oso', 'osa',
    'tion', 'ting', 'ing', 'ers', 'ed',
    'a', 'e', 'i', 'o',
  ];
  function stem(t) {
    if (t.length <= 3) return t;
    for (var i = 0; i < STEM_SUFFIXES.length; i++) {
      var suf = STEM_SUFFIXES[i];
      if (t.length - suf.length >= 3 && t.slice(-suf.length) === suf) {
        return t.slice(0, t.length - suf.length);
      }
    }
    return t;
  }

  function tokenize(s) {
    return normalize(s)
      .replace(/[^a-z0-9àèéìòùç\s]/gi, ' ')
      .split(/\s+/)
      .filter(function (t) { return t.length > 2 && !STOPWORDS[t]; })
      .map(stem);
  }

  /** Spezza un testo in frasi (per lo snippet mirato). */
  function splitSentences(text) {
    var parts = String(text || '').split(/(?<=[.!?;:])\s+|\n+/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p.length > 0) out.push(p);
    }
    return out.length ? out : [String(text || '').trim()];
  }

  function buildIndex(chunks) {
    var docs = chunks.map(function (c, i) {
      var toks = tokenize(c.text);
      var tf = {};
      toks.forEach(function (t) { tf[t] = (tf[t] || 0) + 1; });
      return { i: i, len: toks.length, tf: tf, norm: normalize(c.text) };
    });
    var df = {};
    docs.forEach(function (d) {
      Object.keys(d.tf).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
    });
    var N = docs.length || 1;
    var avgdl = docs.reduce(function (s, d) { return s + d.len; }, 0) / N || 1;
    return { docs: docs, df: df, N: N, avgdl: avgdl };
  }

  function bm25Score(idx, docIndex, queryTokens) {
    var k1 = 1.5, b = 0.75;
    var d = idx.docs[docIndex];
    if (!d) return 0;
    var score = 0, hit = 0;
    for (var qi = 0; qi < queryTokens.length; qi++) {
      var t = queryTokens[qi];
      var f = d.tf[t];
      if (!f) continue;
      hit++;
      var n = idx.df[t] || 0;
      var idf = Math.log(1 + (idx.N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / idx.avgdl)));
    }
    // Copertura: premia i chunk che contengono PIÙ termini distinti della query
    // (discrimina tra domande diverse, riduce i "pareggi" che davano sempre gli
    // stessi risultati).
    if (queryTokens.length > 0) {
      var coverage = hit / queryTokens.length;
      score *= 0.5 + 0.5 * coverage;
    }
    return score;
  }

  /**
   * Estrae lo snippet mirato: la finestra di 1-3 frasi con la maggiore densità
   * di termini della query. Evita di mostrare il chunk grezzo intero.
   */
  function bestSnippet(text, queryTokens) {
    var sentences = splitSentences(text);
    if (sentences.length <= 1) return clip(text, 320);
    var qset = {};
    queryTokens.forEach(function (t) { qset[t] = 1; });
    function sentScore(s) {
      var toks = tokenize(s);
      var hits = 0;
      for (var i = 0; i < toks.length; i++) if (qset[toks[i]]) hits++;
      return hits;
    }
    // Finestra scorrevole di 2 frasi: prende quella con punteggio massimo.
    var best = { score: -1, start: 0, size: 1 };
    for (var i = 0; i < sentences.length; i++) {
      var s1 = sentScore(sentences[i]);
      if (s1 > best.score) best = { score: s1, start: i, size: 1 };
      if (i + 1 < sentences.length) {
        var s2 = s1 + sentScore(sentences[i + 1]);
        if (s2 > best.score) best = { score: s2, start: i, size: 2 };
      }
    }
    if (best.score <= 0) return clip(text, 320);
    var snip = sentences.slice(best.start, best.start + best.size).join(' ');
    // Aggiunge un po' di contesto se troppo corto.
    if (snip.length < 80 && best.start + best.size < sentences.length) {
      snip += ' ' + sentences[best.start + best.size];
    }
    return clip(snip, 360);
  }

  function clip(s, n) {
    s = String(s || '').trim();
    return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s;
  }

  var _index = null;
  var _chunks = null;

  function ensureIndex(chunks) {
    var src = chunks || _chunks || global.__RAG__ || [];
    if (!_index || chunks) {
      _chunks = src;
      _index = buildIndex(src);
    }
    return _index;
  }

  // --- Ricerca semantica TF-IDF cosine (opzionale, pre-calcolata) ----------

  var _semantic = null; // SemanticIndex caricato da window.__RAG_SEMANTIC__

  function loadSemantic() {
    if (_semantic) return _semantic;
    var s = global.__RAG_SEMANTIC__;
    if (!s || !s.vocab || !s.idf || !s.vectors) return null;
    _semantic = s;
    return _semantic;
  }

  /** Cosine similarity tra un vettore denso (query) e uno sparso (chunk). */
  function cosineSparse(qDense, sparse) {
    var dot = 0;
    for (var i = 0; i < sparse.length; i++) {
      dot += qDense[sparse[i][0]] * sparse[i][1];
    }
    return dot; // qDense è L2-normalizzato, sparse[i] pure → dot = cosine
  }

  /** Costruisce il vettore TF-IDF L2-normalizzato per la query. */
  function queryVector(sem, queryTokens) {
    var vocab = sem.vocab;
    var idf = sem.idf;
    var dim = idf.length;
    var vec = new Array(dim);
    var j;
    for (j = 0; j < dim; j++) vec[j] = 0;
    var tf = {};
    for (j = 0; j < queryTokens.length; j++) {
      var col = vocab[queryTokens[j]];
      if (col !== undefined) tf[col] = (tf[col] || 0) + 1;
    }
    var norm = 0;
    for (var c in tf) {
      var ci = Number(c);
      var w = tf[ci] * idf[ci];
      vec[ci] = w;
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (j = 0; j < dim; j++) vec[j] = vec[j] / norm;
    return vec;
  }

  /** Scores semantici per tutti i chunk (cosine con il vettore della query). */
  function semanticScores(sem, queryTokens) {
    var qv = queryVector(sem, queryTokens);
    var scores = [];
    for (var i = 0; i < sem.vectors.length; i++) {
      scores.push(cosineSparse(qv, sem.vectors[i]));
    }
    return scores;
  }

  /**
   * Ricerca: BM25 + copertura, soglia relativa al top (scarta i deboli), snippet
   * mirato, dedup per snippet. Ritorna [] se nessun risultato supera la soglia.
   * Se è presente l'indice semantico (__RAG_SEMANTIC__), combina BM25 e cosine
   * TF-IDF per un ranking migliore (discrimina meglio tra domande diverse).
   */
  function search(query, chunks, k) {
    var idx = ensureIndex(chunks);
    var qt = tokenize(query);
    if (qt.length === 0 || idx.N === 0) return [];

    // BM25 lessicale per ogni chunk.
    var bm = [];
    var bmMax = 0;
    for (var i = 0; i < idx.docs.length; i++) {
      var s = bm25Score(idx, i, qt);
      bm.push(s);
      if (s > bmMax) bmMax = s;
    }

    // Ricerca semantica TF-IDF cosine (se l'indice è impacchettato e allineato).
    var sem = loadSemantic();
    var semScores = null;
    if (sem && sem.vectors && sem.vectors.length === idx.docs.length) {
      semScores = semanticScores(sem, qt);
    }
    var semMax = 0;
    if (semScores) for (var si = 0; si < semScores.length; si++) if (semScores[si] > semMax) semMax = semScores[si];

    // Soglia assoluta di copertura: se il miglior chunk BM25 copre meno del 30%
    // dei termini della query, la domanda è fuori dominio → nessun risultato.
    // Questo evita risposte su argomenti non trattati dal corso (es. "commit git"
    // su un corso di sicurezza) dove un singolo chunk debolmente correlato
    // verrebbe normalizzato a 1.0 e supererebbe la soglia relativa.
    var bestCoverage = 0;
    for (var ci = 0; ci < idx.docs.length; ci++) {
      var hit = 0;
      for (var qi2 = 0; qi2 < qt.length; qi2++) {
        if (idx.docs[ci].tf[qt[qi2]]) hit++;
      }
      var cov = qt.length > 0 ? hit / qt.length : 0;
      if (cov > bestCoverage) bestCoverage = cov;
    }
    if (bestCoverage < 0.3) return [];

    // Punteggio combinato: normalizza BM25 e cosine a [0,1] e fonde 50/50. Senza
    // indice semantico resta il solo BM25 (comportamento invariato).
    var scored = [];
    for (var di = 0; di < idx.docs.length; di++) {
      var bmN = bmMax > 0 ? bm[di] / bmMax : 0;
      var combined;
      if (semScores) {
        // Peso maggiore alla componente TF-IDF (pesa i termini discriminanti
        // per IDF): migliora la pertinenza quando più chunk condividono le
        // parole comuni della query ma solo uno risponde all'intento.
        var semN = semMax > 0 ? semScores[di] / semMax : 0;
        combined = 0.35 * bmN + 0.65 * semN;
      } else {
        combined = bmN;
      }
      // Boost ai contenuti delle LEZIONI del corso rispetto ai documenti della
      // knowledge: il widget "Chiedi al corso" risponde prima sui contenuti del
      // corso. I documenti knowledge restano come supporto, non dominano.
      var ch = _chunks[di];
      if (ch && ch.ref && ch.ref.kind === 'lesson') combined *= 1.5;
      if (combined > 0) scored.push({ i: di, score: combined });
    }
    return formatHits(scored, qt, k);
  }

  /**
   * Da {i,score}[] a hit formattati: ordina, applica soglia relativa 40%,
   * snippet mirato e dedup. CONDIVISO da ricerca lessicale e neurale così i
   * risultati hanno lo stesso formato e le stesse regole di selezione.
   */
  function formatHits(scored, qt, k) {
    if (scored.length === 0) return [];
    scored.sort(function (a, b) { return b.score - a.score; });
    var top = scored[0].score;
    var cutoff = top * 0.4;
    var out = [];
    var seen = {};
    for (var j = 0; j < scored.length && out.length < (k || 4); j++) {
      if (scored[j].score < cutoff) break;
      var c = _chunks[scored[j].i];
      var snippet = bestSnippet(c.text, qt);
      var dedupKey = normalize(snippet).slice(0, 60);
      if (seen[dedupKey]) continue;
      seen[dedupKey] = 1;
      out.push({
        text: c.text,
        snippet: snippet,
        documentName: c.documentName,
        section: c.section,
        ref: c.ref || null,
        score: scored[j].score,
      });
    }
    return out;
  }

  // --- Ricerca NEURALE (embeddings MiniLM, opzionale) -----------------------

  var _embeddings = null;      // Array<Float32Array> dei chunk (de-quantizzati)
  var _embeddingsPromise = null;
  var _neuralBasePath = '';    // base path del pacchetto (es. '../' da pages/)

  /** Configura e abilita la ricerca neurale se gli asset sono impacchettati. */
  function configureNeural(basePath) {
    if (!global.__RAG_EMBED_META__ || !global.SemanticRuntime) return false;
    var meta = global.__RAG_EMBED_META__;
    _neuralBasePath = basePath || '';
    global.SemanticRuntime.configure({
      transformersUrl: _neuralBasePath + 'runtime/semantic/transformers.min.js',
      modelsPath: _neuralBasePath + 'runtime/semantic/models/',
      wasmPath: _neuralBasePath + 'runtime/semantic/',
      modelId: meta.model,
    });
    return true;
  }

  function neuralAvailable() {
    return !!(global.__RAG_EMBED_META__ && global.SemanticRuntime && global.SemanticRuntime.available());
  }

  /** Carica (una volta) gli embeddings dei chunk de-quantizzati dal file .bin. */
  function loadChunkEmbeddings() {
    if (_embeddingsPromise) return _embeddingsPromise;
    _embeddingsPromise = (async function () {
      var meta = global.__RAG_EMBED_META__;
      var res = await fetch(_neuralBasePath + 'content/rag-embeddings.bin');
      var buf = await res.arrayBuffer();
      _embeddings = global.SemanticRuntime.decodeInt8(buf, meta.dim);
      return _embeddings;
    })();
    return _embeddingsPromise;
  }

  /**
   * Ricerca NEURALE: embedda la query con MiniLM, cosine coi vettori dei chunk
   * (pre-calcolati all'export, STESSO modello → coerenza), boost lezioni ×1.5,
   * poi stessa soglia/snippet/dedup del lessicale. Ritorna [] sotto soglia di
   * pertinenza assoluta (0.25 cosine) per non rispondere a domande fuori tema.
   */
  async function searchNeural(query, k) {
    ensureIndex(null);
    var qt = tokenize(query);
    var chunkVecs = await loadChunkEmbeddings();
    if (!chunkVecs || chunkVecs.length !== _chunks.length) {
      throw new Error('embeddings non allineati ai chunk');
    }
    var qv = await global.SemanticRuntime.embedQuery(query);
    var cos = global.SemanticRuntime.cosine;
    var scored = [];
    var best = 0;
    for (var i = 0; i < chunkVecs.length; i++) {
      var s = cos(qv, chunkVecs[i]);
      if (s > best) best = s;
      // Boost lezioni (coerente con il lessicale).
      var ch = _chunks[i];
      if (ch && ch.ref && ch.ref.kind === 'lesson') s *= 1.15;
      scored.push({ i: i, score: s });
    }
    // Soglia assoluta di pertinenza: se il miglior cosine è basso, fuori tema.
    if (best < 0.25) return [];
    return formatHits(scored, qt, k);
  }

  // --- Integrazione AI integrata del browser (window.ai), opzionale ---------

  function getBrowserLM() {
    // API sperimentali Chrome: LanguageModel (nuovo) o window.ai.* (vecchio).
    if (typeof global.LanguageModel !== 'undefined') return { kind: 'languageModel', api: global.LanguageModel };
    if (global.ai && global.ai.languageModel) return { kind: 'ai', api: global.ai.languageModel };
    return null;
  }

  // Sessione del modello riusata tra le domande: create() (e il primo
  // caricamento del modello on-device) è costoso; rifarlo a ogni ricerca rende
  // la risposta lenta. La teniamo in cache e la ricreiamo solo se fallisce.
  var _lmSession = null;
  async function getLMSession(api) {
    if (_lmSession) {
      try { return await _lmSession; } catch (e) { _lmSession = null; }
    }
    _lmSession = api.create();
    try { return await _lmSession; } catch (e) { _lmSession = null; throw e; }
  }

  async function generateAnswer(query, hits, onToken) {
    var lm = getBrowserLM();
    if (!lm || hits.length === 0) return null;
    // Solo i primi 2 passaggi troncati: prompt più corto → risposta più veloce.
    var context = hits.slice(0, 2).map(function (h, i) { return '[' + (i + 1) + '] ' + (h.snippet || '').slice(0, 200); }).join('\n');
    var prompt =
      'Rispondi alla domanda usando SOLO il contesto. Se il contesto non basta, dillo.\n\n' +
      'Contesto:\n' + context + '\n\nDomanda: ' + query + '\n\nRisposta concisa in italiano:';
    try {
      var apiRef = lm.kind === 'languageModel' ? global.LanguageModel : lm.api;
      if (apiRef.availability) {
        var avail = await apiRef.availability();
        if (avail === 'unavailable') return null;
      }
      // Riusa la sessione: evita create()/caricamento modello a ogni domanda.
      var session = await getLMSession(apiRef);
      // Streaming: la risposta appare parola per parola (più reattiva).
      // chunk.value è CUMULATIVO (Prompt API). Se lo stream si tronca (Gemini
      // Nano può farlo), full resta con poca roba: in quel caso rigeneriamo con
      // prompt() sincrono su nuova sessione.
      if (onToken && session.promptStreaming) {
        var stream = session.promptStreaming(prompt);
        var reader = stream.getReader();
        var full = '';
        while (true) {
          var res = await reader.read();
          if (res.done) break;
          full = res.value; // cumulativo
          onToken(full);
        }
        // Verifica: risposta sostanziale? (> 10 char alfanumerici)
        if (full.replace(/[^a-zA-Z0-9\u00C0-\u024F]/g, '').length >= 10) {
          return full;
        }
        // Stream troncato: prova con prompt() sincrono (nuova sessione).
        _lmSession = null;
        session = await getLMSession(apiRef);
      }
      return await session.prompt(prompt);
    } catch (e) {
      _lmSession = null; // in errore, forza la ricreazione alla prossima domanda
      return null; // fallback: estrattivo
    }
  }

  /**
   * Rileva se la risposta dell'AI è un rifiuto ("non ho informazioni", "non
   * fornisce dati", ecc.) — in quel caso la nascondiamo e mostriamo solo i
   * passaggi estrattivi, che sono comunque presenti.
   */
  function isRefusal(text) {
    var t = normalize(text);
    // Specifico: il rifiuto deve riferirsi a contesto/informazioni/dati/
    // passaggi/materiale. Una risposta valida con "non ha effetto..." NON va
    // scartata.
    var subj = '(contesto|informazion\\w*|dati|passagg\\w*|material\\w*|testo|font\\w*)';
    return new RegExp('non (fornisce|contiene|ho|ha|ci sono|trovo|sono presenti|include|riporta|menziona)[^.]{0,40}' + subj).test(t) ||
           new RegExp(subj + '[^.]{0,20}non (bast\\w*|sufficient\\w*|present\\w*|disponibil\\w*)').test(t) ||
           /non (e|è)? ?possibile rispondere/.test(t) ||
           /informazioni (non|in)sufficienti/.test(t) ||
           /fuori (dal )?(contesto|tema|argomento)/.test(t);
  }

  // --- Widget UI ------------------------------------------------------------

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    (children || []).forEach(function (c) {
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  /**
   * Indicatore "sta pensando": etichetta + tre puntini pulsanti animati. Rende
   * evidente che il modello sta lavorando (niente stato statico "bloccato").
   * L'animazione è in CSS (rispetta prefers-reduced-motion lato foglio di stile).
   */
  function buildTypingIndicator() {
    var wrap = el('div', { class: 'rag-answer-loading', 'aria-live': 'polite' });
    wrap.appendChild(el('span', { class: 'rag-loading-label' }, ['Sto formulando una risposta']));
    var dots = el('span', { class: 'rag-typing', 'aria-hidden': 'true' });
    dots.appendChild(el('span', { class: 'rag-dot' }));
    dots.appendChild(el('span', { class: 'rag-dot' }));
    dots.appendChild(el('span', { class: 'rag-dot' }));
    wrap.appendChild(dots);
    return wrap;
  }

  function sourceLabel(h) {
    if (h.ref && h.ref.kind === 'lesson') {
      return 'Trattato in: Modulo ' + h.ref.moduleIndex + ' › Lezione ' + h.ref.lessonIndex +
        (h.section ? ' (' + h.section + ')' : '');
    }
    return 'Fonte: ' + h.documentName + (h.section ? ' — ' + h.section : '');
  }

  function mount(root, chunks, options) {
    var host = root || document.body;
    var data = chunks || global.__RAG__ || [];
    if (!data || data.length === 0) return null;
    ensureIndex(data);
    var onJump = options && options.onJump; // (ref) => void, per il salto alla lezione

    var panel = el('div', { class: 'rag-panel', hidden: 'hidden', role: 'dialog', 'aria-label': 'Chiedi al corso' });
    var head = el('div', { class: 'rag-head' }, [el('span', { class: 'rag-title' }, ['Chiedi al corso'])]);
    var closeBtn = el('button', { class: 'rag-close', type: 'button', 'aria-label': 'Chiudi' }, ['\u00d7']);
    head.appendChild(closeBtn);
    var form = el('form', { class: 'rag-form' });
    var input = el('input', { class: 'rag-input', type: 'text', placeholder: 'Fai una domanda sul corso…', 'aria-label': 'Domanda' });
    var submit = el('button', { class: 'rag-submit', type: 'submit' }, ['Cerca']);
    form.appendChild(input);
    form.appendChild(submit);
    var results = el('div', { class: 'rag-results' });
    var hasLM = !!getBrowserLM();
    var hint = el('p', { class: 'rag-hint' }, [
      hasLM ? 'La risposta AI è sintetizzata localmente; le fonti sono estratti letterali dal corso.'
            : 'Le risposte sono estratti letterali dai materiali del corso.',
    ]);
    panel.appendChild(head);
    panel.appendChild(form);
    panel.appendChild(results);
    panel.appendChild(hint);

    var fab = el('button', { class: 'rag-fab', type: 'button', 'aria-label': 'Chiedi al corso', title: 'Chiedi al corso' }, ['? Chiedi al corso']);

    function open() { panel.removeAttribute('hidden'); fab.setAttribute('hidden', 'hidden'); input.focus(); }
    function close() { panel.setAttribute('hidden', 'hidden'); fab.removeAttribute('hidden'); }
    fab.addEventListener('click', open);
    closeBtn.addEventListener('click', close);

    function renderHit(h) {
      var card = el('div', { class: 'rag-result' });
      card.appendChild(el('p', { class: 'rag-result-text' }, [h.snippet || clip(h.text, 360)]));
      var srcText = sourceLabel(h);
      if (h.ref && h.ref.kind === 'lesson' && onJump) {
        var link = el('button', { class: 'rag-result-src rag-result-link', type: 'button' }, [srcText + ' →']);
        link.addEventListener('click', function () { close(); onJump(h.ref); });
        card.appendChild(link);
      } else {
        card.appendChild(el('p', { class: 'rag-result-src' }, [srcText]));
      }
      return card;
    }

    /** Mostra i risultati (fonti) + eventuale risposta AI. Condiviso. */
    function renderResults(q, hits, mode) {
      results.innerHTML = '';
      // Badge della modalità di ricerca (Neurale vs Lessicale).
      var badge = el('div', { class: 'rag-mode-badge' + (mode === 'neural' ? ' is-neural' : '') });
      badge.appendChild(el('span', { class: 'rag-mode-dot' }));
      badge.appendChild(el('span', {}, [mode === 'neural' ? 'Neurale' : 'Lessicale']));
      hint.innerHTML = '';
      hint.appendChild(badge);
      hint.appendChild(document.createTextNode(
        hasLM ? ' AI locale \u00b7 fonti dal corso' : ' Estratti dai materiali',
      ));

      if (hits.length === 0) {
        results.appendChild(el('p', { class: 'rag-empty' }, ['Nessun passaggio pertinente trovato nei materiali del corso.']));
        return;
      }
      // 1) RISPOSTA AI (solo se il browser espone l'AI): card distinta.
      var answerBox = null;
      if (hasLM) {
        answerBox = el('div', { class: 'rag-answer' });
        answerBox.appendChild(el('div', { class: 'rag-answer-head' }, ['\u2728 Risposta AI']));
        var abody = el('div', { class: 'rag-answer-body' });
        abody.appendChild(buildTypingIndicator());
        answerBox.appendChild(abody);
        results.appendChild(answerBox);
      }
      // 2) FONTI: estratti letterali dal corso, con link alle lezioni.
      var srcHead = el('div', { class: 'rag-sources-head' }, [
        '\uD83D\uDCD6 ' + (hasLM ? 'Fonti \u00b7 estratti dal corso' : 'Estratti dal corso'),
      ]);
      results.appendChild(srcHead);
      hits.forEach(function (h) { results.appendChild(renderHit(h)); });
      // 3) Completa la risposta AI con STREAMING (parola per parola).
      if (answerBox) {
        generateAnswer(q, hits, function onToken(partial) {
          // Aggiorna il body con il testo parziale.
          var body = answerBox.querySelector('.rag-answer-body');
          body.innerHTML = '';
          body.appendChild(el('p', { class: 'rag-answer-text' }, [partial]));
        }).then(function (ans) {
          var body = answerBox.querySelector('.rag-answer-body');
          var clean = (ans || '').trim();
          var meaningful = clean.replace(/[^a-zA-Z0-9\u00C0-\u024F]/g, '').length >= 10;
          if (meaningful && !isRefusal(clean)) {
            body.innerHTML = '';
            body.appendChild(el('p', { class: 'rag-answer-text' }, [clean]));
            body.appendChild(el('p', { class: 'rag-answer-disclaimer' }, [
              'Generata dall\u2019AI del browser dai passaggi qui sotto. Verifica sulle fonti.',
            ]));
          } else {
            if (answerBox.parentNode) answerBox.parentNode.removeChild(answerBox);
            srcHead.textContent = '\uD83D\uDCD6 Estratti dal corso';
          }
        });
      }
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var q = input.value.trim();
      results.innerHTML = '';
      if (!q) return;

      // Ricerca NEURALE (primaria) se il modello è impacchettato; altrimenti
      // (o in caso di errore) fallback alla ricerca lessicale. STESSE regole di
      // formato/soglia/snippet → coerenza anteprima↔SCORM.
      if (neuralAvailable()) {
        var loading = el('div', { class: 'rag-model-loading' });
        loading.appendChild(el('span', {}, ['Cerco nei contenuti del corso']));
        loading.appendChild(buildTypingIndicator());
        results.appendChild(loading);
        try {
          var neuralHits = await searchNeural(q, 4);
          renderResults(q, neuralHits, 'neural');
          return;
        } catch (err) {
          // Fallback lessicale sotto.
        }
      }
      renderResults(q, search(q, null, 4), 'lexical');
    });

    host.appendChild(fab);
    host.appendChild(panel);
    return { open: open, close: close, panel: panel, fab: fab };
  }

  global.CourseRag = {
    search: search,
    searchNeural: searchNeural,
    mount: mount,
    buildIndex: buildIndex,
    tokenize: tokenize,
    bestSnippet: bestSnippet,
    generateAnswer: generateAnswer,
    configureNeural: configureNeural,
    neuralAvailable: neuralAvailable,
    formatHits: formatHits,
  };

  if (typeof document !== 'undefined') {
    var auto = function () {
      if (global.__RAG__ && global.__RAG__.length) {
        // La pagina SCO è in pages/index.html → base path del pacchetto = '../'.
        configureNeural('../');
        mount(document.body, global.__RAG__, {
          onJump: function (ref) {
            // Salto alla lezione nel player SCORM, se disponibile.
            if (global.__player__ && typeof global.__player__.goToLesson === 'function' && ref && ref.lessonId) {
              global.__player__.goToLesson(ref.lessonId);
            }
          },
        });
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto);
    else auto();
  }
})(typeof window !== 'undefined' ? window : this);
