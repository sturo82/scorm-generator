/*
 * scorm-api.js — Wrapper della SCORM Run-Time API (Requisito 9.3 / 6.5).
 * JavaScript vanilla eseguito nel browser dentro l'LMS. Nessuna dipendenza
 * esterna, nessuna richiesta di rete: tutto gira offline nel pacchetto.
 *
 * Supporta sia SCORM 2004 (API_1484_11) sia SCORM 1.2 (API), individuando
 * l'handle risalendo i frame. Espone un'interfaccia uniforme con mapping dei
 * modelli dati (completion, success, score, suspend, location). Se l'API non è
 * presente (anteprima fuori dall'LMS) degrada senza errori.
 */
(function (global) {
  'use strict';

  function findAPI(win, names, maxDepth) {
    var depth = 0;
    var current = win;
    while (current) {
      for (var i = 0; i < names.length; i++) {
        if (current[names[i]]) return { api: current[names[i]], name: names[i] };
      }
      if (current.parent && current.parent !== current && depth < maxDepth) {
        current = current.parent;
        depth++;
      } else {
        break;
      }
    }
    // Prova anche nell'opener (alcuni LMS aprono lo SCO in una nuova finestra).
    if (win.opener) return findAPI(win.opener, names, maxDepth);
    return null;
  }

  function ScormApi() {
    this.found = null;
    this.version = null; // '2004' | '1.2' | null
    this.initialized = false;
  }

  ScormApi.prototype.discover = function (win) {
    win = win || global;
    // Prima SCORM 2004, poi 1.2.
    var found = findAPI(win, ['API_1484_11'], 10);
    if (found) {
      this.found = found.api;
      this.version = '2004';
    } else {
      found = findAPI(win, ['API'], 10);
      if (found) {
        this.found = found.api;
        this.version = '1.2';
      }
    }
    return this.version;
  };

  // Nomi degli elementi del data model mappati per versione.
  ScormApi.prototype._el = function (key) {
    var map2004 = {
      completion: 'cmi.completion_status',
      success: 'cmi.success_status',
      scoreScaled: 'cmi.score.scaled',
      scoreRaw: 'cmi.score.raw',
      scoreMin: 'cmi.score.min',
      scoreMax: 'cmi.score.max',
      location: 'cmi.location',
      suspend: 'cmi.suspend_data',
      exit: 'cmi.exit',
    };
    var map12 = {
      completion: 'cmi.core.lesson_status',
      success: 'cmi.core.lesson_status',
      scoreScaled: null, // non esiste in 1.2
      scoreRaw: 'cmi.core.score.raw',
      scoreMin: 'cmi.core.score.min',
      scoreMax: 'cmi.core.score.max',
      location: 'cmi.core.lesson_location',
      suspend: 'cmi.suspend_data',
      exit: 'cmi.core.exit',
    };
    return (this.version === '2004' ? map2004 : map12)[key];
  };

  ScormApi.prototype._call = function (method2004, method12, args) {
    if (!this.found) return '';
    var m = this.version === '2004' ? method2004 : method12;
    return this.found[m].apply(this.found, args || []);
  };

  ScormApi.prototype.initialize = function () {
    if (!this.found) return false;
    var ok = this._call('Initialize', 'LMSInitialize', ['']);
    this.initialized = ok === 'true' || ok === true;
    return this.initialized;
  };

  ScormApi.prototype.getValue = function (key) {
    var el = this._el(key);
    if (!el || !this.found) return '';
    return this._call('GetValue', 'LMSGetValue', [el]);
  };

  ScormApi.prototype.setValue = function (key, value) {
    var el = this._el(key);
    if (!el || !this.found) return false;
    var r = this._call('SetValue', 'LMSSetValue', [el, String(value)]);
    return r === 'true' || r === true;
  };

  ScormApi.prototype.commit = function () {
    return this._call('Commit', 'LMSCommit', ['']) !== 'false';
  };

  ScormApi.prototype.terminate = function () {
    if (!this.found || !this.initialized) return false;
    // Imposta exit=suspend per preservare lo stato dove supportato.
    this.setValue('exit', this.version === '2004' ? 'suspend' : 'suspend');
    var r = this._call('Terminate', 'LMSFinish', ['']);
    this.initialized = false;
    return r === 'true' || r === true;
  };

  // --- API di alto livello usata dal player ---------------------------------

  /** Imposta il punteggio in modo coerente tra 2004 e 1.2. */
  ScormApi.prototype.setScore = function (scaled, raw, min, max) {
    if (this.version === '2004') {
      if (scaled != null) this.setValue('scoreScaled', clamp(scaled, 0, 1));
    }
    if (raw != null) this.setValue('scoreRaw', raw);
    if (min != null) this.setValue('scoreMin', min);
    if (max != null) this.setValue('scoreMax', max);
  };

  /** Imposta completamento e superamento. passed/null, completed bool. */
  ScormApi.prototype.setOutcome = function (completed, passed) {
    if (this.version === '2004') {
      this.setValue('completion', completed ? 'completed' : 'incomplete');
      if (passed != null) this.setValue('success', passed ? 'passed' : 'failed');
    } else {
      // In 1.2 lo stato è unico: priorità al passed/failed, altrimenti completed.
      if (passed != null) this.setValue('completion', passed ? 'passed' : 'failed');
      else this.setValue('completion', completed ? 'completed' : 'incomplete');
    }
  };

  ScormApi.prototype.saveBookmark = function (location, suspendData) {
    if (location != null) this.setValue('location', location);
    if (suspendData != null) this.setValue('suspend', suspendData);
    this.commit();
  };

  function clamp(n, lo, hi) {
    n = Number(n);
    if (isNaN(n)) return lo;
    return Math.max(lo, Math.min(hi, n));
  }

  global.ScormApi = ScormApi;
  // Istanza singleton comoda per il player.
  global.SCORM = new ScormApi();

  // Esportazione per i test (CommonJS/jsdom) senza impattare il browser.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ScormApi: ScormApi, findAPI: findAPI, clamp: clamp };
  }
})(typeof window !== 'undefined' ? window : this);
