/*
 * renderers.js — Ponte verso il renderer condiviso (@scorm/contracts/render-core,
 * bundle window.RenderCore) per TUTTI i tipi di block, più i renderer degli
 * assessment (quiz) che restano locali. JS vanilla per il browser dell'LMS.
 *
 * I 12 tipi di block sono renderizzati dal core condiviso: renderBlock() delega
 * a window.RenderCore. È mantenuto un fallback minimale per `rich_text` nel caso
 * (teorico) in cui il bundle del core non sia caricato. La valutazione dei
 * quiz (Scoring.gradeAssessment) e il gating sono gestiti dal player.
 */
(function (global) {
  'use strict';

  /* Etichette del quiz nella LINGUA DEL CORSO (letta da window.__COURSE__).
     Allineato a @scorm/contracts/course-labels.ts per it/en; fallback inglese. */
  var QUIZ_LABELS = {
    en: {
      submit: 'Submit answers', yes: 'True', no: 'False', answer: 'Answer',
      blankN: function (i) { return 'Blank ' + i; },
      choose: 'Choose…', wordBank: 'Words to use',
      matchHint: 'Pick the matching description for each item.',
      orderHint: 'Use the arrows to put the items in the right order.',
      moveUp: function (t) { return 'Move up: ' + t; },
      moveDown: function (t) { return 'Move down: ' + t; },
      multiHint: 'Select all the correct answers.',
      correct: 'Correct', wrong: 'Not correct',
    },
    it: {
      submit: 'Invia risposte', yes: 'Vero', no: 'Falso', answer: 'Risposta',
      blankN: function (i) { return 'Spazio ' + i; },
      choose: 'Scegli…', wordBank: 'Parole da usare',
      matchHint: 'Per ogni voce scegli la descrizione corrispondente.',
      orderHint: 'Usa le frecce per mettere gli elementi nell’ordine giusto.',
      moveUp: function (t) { return 'Sposta su: ' + t; },
      moveDown: function (t) { return 'Sposta giù: ' + t; },
      multiHint: 'Seleziona tutte le risposte corrette.',
      correct: 'Corretto', wrong: 'Non corretto',
    },
  };
  function quizLabels() {
    var course = global.__COURSE__ || {};
    var key = String(course.language || '').slice(0, 2).toLowerCase();
    return QUIZ_LABELS[key] || QUIZ_LABELS.en;
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function rich(node) {
    // node = { format:'html', html:'...' } — l'HTML è già sanificato lato server.
    return el('div', { class: 'block-rich', html: node && node.html ? node.html : '' });
  }

  // Fallback locale minimale (usato solo se window.RenderCore non è disponibile).
  var fallbackRenderers = {
    rich_text: function (p) {
      var block = el('div', { class: 'block' }, [rich(p.content)]);
      (p.media || []).forEach(function (m) {
        if (m && m.storageKey && (!m.kind || m.kind === 'image')) {
          block.appendChild(el('img', { class: 'block-media', src: m.storageKey, alt: m.alt || '', loading: 'lazy' }));
        }
      });
      return block;
    },
  };

  // Contesto di rendering per il core condiviso: nel pacchetto SCORM lo
  // storageKey è GIÀ un path relativo (../media/...) riscritto dal builder,
  // quindi resolveMedia lo restituisce tale e quale. Le etichette interne ai
  // block seguono la LINGUA DEL CORSO (window.__COURSE__.language) via
  // RenderCore.courseLabels; calcolate una sola volta e memorizzate.
  var _coreCtx = null;
  function coreCtx() {
    if (_coreCtx) return _coreCtx;
    var core = global.RenderCore;
    var course = global.__COURSE__ || {};
    _coreCtx = {
      resolveMedia: function (m) {
        return m && m.storageKey ? m.storageKey : null;
      },
      labels: core && core.courseLabels ? core.courseLabels(course.language) : undefined,
    };
    return _coreCtx;
  }

  function renderBlock(block) {
    // Tutti i tipi sono gestiti dal renderer condiviso (window.RenderCore):
    // un'unica implementazione per anteprima ed export.
    var core = global.RenderCore;
    if (core && core.isHandledByCore(block.type)) {
      return core.renderBlockDom(block, coreCtx());
    }
    var fn = fallbackRenderers[block.type];
    if (!fn) return el('div', { class: 'block unknown' }, ['[tipo non supportato: ' + block.type + ']']);
    return fn(block.payload || {});
  }

  /**
   * Lezione VIDEO-FIRST a due colonne (video grande + barra tab laterale con
   * Contenuto/Attività/Trascrizione), dal renderer CONDIVISO. Un unico markup
   * per anteprima ed export. Fallback: se il core non è caricato, impila i
   * block con renderBlock() (comportamento legacy, non blocca la fruizione).
   */
  function renderVideoFirstLesson(blocks) {
    var core = global.RenderCore;
    if (core && core.renderVideoFirstLessonDom) {
      return core.renderVideoFirstLessonDom(blocks || [], coreCtx());
    }
    var wrap = el('div', { class: 'lesson-videofirst' });
    (blocks || []).forEach(function (b) { wrap.appendChild(renderBlock(b)); });
    return wrap;
  }

  /**
   * Lezione PILLOLA: contenitore scorrevole con una card per blocco (contenuto
   * vs azioni distinti), dal renderer CONDIVISO. Fallback: impila i block.
   */
  function renderPillolaLesson(blocks) {
    var core = global.RenderCore;
    if (core && core.renderPillolaLessonDom) {
      return core.renderPillolaLessonDom(blocks || [], coreCtx());
    }
    var wrap = el('div', { class: 'lesson-pillola' });
    (blocks || []).forEach(function (b) { wrap.appendChild(renderBlock(b)); });
    return wrap;
  }

  /**
   * Lezione PILLOLA INTERATTIVA (libro-game): lo scenario a scene/scelte a tutto
   * riquadro, dal renderer CONDIVISO. Fallback: impila i block.
   */
  function renderPillolaInterattivaLesson(blocks) {
    var core = global.RenderCore;
    if (core && core.renderPillolaInterattivaLessonDom) {
      return core.renderPillolaInterattivaLessonDom(blocks || [], coreCtx());
    }
    var wrap = el('div', { class: 'lesson-pillola-interattiva' });
    (blocks || []).forEach(function (b) { wrap.appendChild(renderBlock(b)); });
    return wrap;
  }

  // --- Rendering di un assessment (test) --------------------------------------
  // Costruisce il form delle domande per tutti i tipi, raccoglie le risposte in
  // una mappa questionId -> answer e, al submit, invoca onSubmit(answers). La
  // valutazione (Scoring.gradeAssessment) e il gating sono gestiti dal player.

  /** Hash stabile di una stringa: l'ordine mescolato resta lo stesso a ogni render. */
  function hashString(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul ? Math.imul(h, 16777619) : (h * 16777619) | 0;
    }
    return h >>> 0;
  }

  /**
   * Mescola in modo deterministico (seme = id della domanda). Se il risultato coincide con
   * l'ordine originale lo ruota di uno: abbinamenti e riordino non devono mai presentarsi già risolti.
   */
  function stableShuffle(list, seed) {
    var out = list.slice();
    var state = hashString(String(seed)) || 1;
    for (var i = out.length - 1; i > 0; i--) {
      state = (state * 1103515245 + 12345) >>> 0;
      var j = state % (i + 1);
      var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    if (out.length > 1) {
      var same = true;
      for (var k = 0; k < out.length; k++) if (out[k] !== list[k]) { same = false; break; }
      if (same) out.push(out.shift());
    }
    return out;
  }

  /**
   * Divide il testo di una domanda "completa la frase" in parti di testo e spazi. Accetta il
   * formato del contratto ({{1}}) e quelli prodotti in passato dall'AI ([1], [BLANK_1], ___).
   */
  var BLANK_RE = /\{\{\s*(\d+)\s*\}\}|\[\s*(?:blank[\s_-]*)?(\d+)\s*\]|_{3,}/gi;
  function splitTemplate(template) {
    var parts = [];
    var last = 0;
    var seq = 0;
    var m;
    var text = String(template || '');
    BLANK_RE.lastIndex = 0;
    while ((m = BLANK_RE.exec(text)) !== null) {
      if (m.index > last) parts.push({ text: text.slice(last, m.index) });
      seq++;
      var n = m[1] || m[2];
      parts.push({ blank: n ? Number(n) : seq });
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ text: text.slice(last) });
    return parts;
  }

  /** Testo semplice da un feedback generato (toglie il grassetto markdown). */
  function plain(s) {
    return String(s || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
  }

  function renderAssessment(assessment, options) {
    options = options || {};
    var answers = {};
    var container = el('div', { class: 'assessment' });
    container.appendChild(el('h2', { class: 'assessment-title' }, [assessment.title || 'Test']));

    (assessment.questions || []).forEach(function (q, qi) {
      var fieldset = el('fieldset', { class: 'question question-' + q.type, 'data-qid': q.id });
      var legend = el('legend', {}, [
        el('span', { class: 'question-num' }, [String(qi + 1)]),
        el('span', { class: 'question-text' }, [q.prompt || '']),
      ]);
      fieldset.appendChild(legend);
      var hint = q.type === 'multiple_choice' ? quizLabels().multiHint
        : q.type === 'matching' ? quizLabels().matchHint
          : q.type === 'ordering' ? quizLabels().orderHint : '';
      if (hint) fieldset.appendChild(el('p', { class: 'question-hint' }, [hint]));
      fieldset.appendChild(buildQuestionInput(q, answers));
      fieldset.appendChild(el('p', { class: 'question-feedback', hidden: 'hidden', role: 'status' }));
      container.appendChild(fieldset);
    });

    var feedback = el('div', { class: 'assessment-feedback', hidden: 'hidden', role: 'status' });
    var submit = el('button', { class: 'assessment-submit', type: 'button' }, [quizLabels().submit]);
    submit.addEventListener('click', function () {
      if (typeof options.onSubmit === 'function') options.onSubmit(answers, feedback, submit);
    });
    container.appendChild(submit);
    container.appendChild(feedback);
    return container;
  }

  /** Dopo l'invio: segna ogni domanda giusta o sbagliata e mostra il suo feedback. */
  function showQuestionResults(root, assessment, perQuestion) {
    var byId = {};
    (assessment.questions || []).forEach(function (q) { byId[q.id] = q; });
    (perQuestion || []).forEach(function (r) {
      var fs = root.querySelector('fieldset.question[data-qid="' + String(r.id).replace(/"/g, '\\"') + '"]');
      if (!fs) return;
      fs.classList.remove('is-correct', 'is-wrong');
      fs.classList.add(r.correct ? 'is-correct' : 'is-wrong');
      var q = byId[r.id] || {};
      var fb = fs.querySelector('.question-feedback');
      if (!fb) return;
      var detail = plain(r.correct ? q.feedbackCorrect : q.feedbackIncorrect);
      fb.textContent = (r.correct ? quizLabels().correct : quizLabels().wrong) + (detail ? ' — ' + detail : '');
      fb.removeAttribute('hidden');
    });
  }

  /** Crea l'input adeguato al tipo di domanda, aggiornando la mappa answers. */
  function buildQuestionInput(q, answers) {
    var wrap = el('div', { class: 'question-input' });
    var name = 'q_' + q.id;
    switch (q.type) {
      case 'single_choice':
      case 'true_false': {
        var opts = q.type === 'true_false'
          ? [{ id: 'true', text: quizLabels().yes }, { id: 'false', text: quizLabels().no }]
          : (q.choices || []);
        if (q.type === 'true_false') wrap.className += ' is-tf';
        opts.forEach(function (c) {
          var oid = name + '_' + c.id;
          var input = el('input', { type: 'radio', name: name, id: oid, value: c.id });
          input.addEventListener('change', function () {
            answers[q.id] = q.type === 'true_false' ? c.id === 'true' : c.id;
          });
          wrap.appendChild(el('label', { class: 'opt', for: oid }, [input, el('span', { class: 'opt-text' }, [c.text])]));
        });
        break;
      }
      case 'multiple_choice': {
        answers[q.id] = [];
        (q.choices || []).forEach(function (c) {
          var cid = name + '_' + c.id;
          var input = el('input', { type: 'checkbox', id: cid, value: c.id });
          input.addEventListener('change', function () {
            var arr = answers[q.id] || [];
            if (input.checked) arr.push(c.id);
            else arr = arr.filter(function (x) { return x !== c.id; });
            answers[q.id] = arr;
          });
          wrap.appendChild(el('label', { class: 'opt opt-multi', for: cid }, [input, el('span', { class: 'opt-text' }, [c.text])]));
        });
        break;
      }
      case 'short_text': {
        var text = el('input', { type: 'text', class: 'text-answer', 'aria-label': q.prompt || quizLabels().answer });
        text.addEventListener('input', function () { answers[q.id] = text.value; });
        wrap.appendChild(text);
        break;
      }
      case 'matching': {
        answers[q.id] = {};
        // Le descrizioni si offrono in ordine mescolato: nello stesso ordine delle voci la risposta sarebbe ovvia.
        var rights = stableShuffle((q.pairs || []).map(function (p) { return p.right; }), q.id);
        (q.pairs || []).forEach(function (pair, pi) {
          var sid = name + '_m' + pi;
          var sel = el('select', { id: sid, class: 'match-select' });
          sel.appendChild(el('option', { value: '' }, [quizLabels().choose]));
          rights.forEach(function (r) { sel.appendChild(el('option', { value: r }, [r])); });
          sel.addEventListener('change', function () {
            answers[q.id][pair.id] = sel.value;
            row.classList.toggle('is-set', sel.value !== '');
          });
          var row = el('div', { class: 'match-row' }, [
            el('label', { class: 'match-left', for: sid }, [pair.left]),
            sel,
          ]);
          wrap.appendChild(row);
        });
        break;
      }
      case 'ordering': {
        // Elenco mescolato con frecce su/giù (tastiera e touch); la risposta è l'ordine mostrato.
        var items = stableShuffle(q.items || [], q.id);
        var list = el('ol', { class: 'order-list' });
        var sync = function () {
          var map = {};
          Array.prototype.forEach.call(list.children, function (li, i) {
            map[li.getAttribute('data-item')] = i + 1;
            var up = li.querySelector('.order-up');
            var down = li.querySelector('.order-down');
            if (up) up.disabled = i === 0;
            if (down) down.disabled = i === list.children.length - 1;
          });
          answers[q.id] = map;
        };
        var move = function (li, dir, focusSel) {
          if (dir < 0 && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
          else if (dir > 0 && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
          sync();
          var btn = li.querySelector(focusSel);
          if (btn && !btn.disabled) btn.focus();
          li.classList.remove('is-moved');
          void li.offsetWidth;
          li.classList.add('is-moved');
        };
        items.forEach(function (item) {
          var up = el('button', { type: 'button', class: 'order-btn order-up', 'aria-label': quizLabels().moveUp(item.label) }, ['\u2191']);
          var down = el('button', { type: 'button', class: 'order-btn order-down', 'aria-label': quizLabels().moveDown(item.label) }, ['\u2193']);
          var li = el('li', { class: 'order-item', 'data-item': item.id }, [
            el('span', { class: 'order-label' }, [item.label]),
            el('span', { class: 'order-controls' }, [up, down]),
          ]);
          up.addEventListener('click', function () { move(li, -1, '.order-up'); });
          down.addEventListener('click', function () { move(li, 1, '.order-down'); });
          list.appendChild(li);
        });
        wrap.appendChild(list);
        sync();
        break;
      }
      case 'fill_blank': {
        answers[q.id] = {};
        // Parole suggerite (facoltative): se ci sono, ogni spazio è un menu a tendina.
        var bank = Array.isArray(q.options) && q.options.length > 0 ? stableShuffle(q.options, q.id) : null;
        var makeField = function (blank) {
          var field;
          if (bank) {
            field = el('select', { class: 'blank-input blank-select', 'aria-label': quizLabels().blankN(blank.index) });
            field.appendChild(el('option', { value: '' }, [quizLabels().choose]));
            bank.forEach(function (w) { field.appendChild(el('option', { value: w }, [w])); });
            field.addEventListener('change', function () { answers[q.id][blank.index] = field.value; });
          } else {
            var longest = 0;
            (blank.accepted || []).forEach(function (a) { longest = Math.max(longest, String(a).length); });
            field = el('input', {
              type: 'text',
              class: 'blank-input',
              autocomplete: 'off',
              spellcheck: 'false',
              'aria-label': quizLabels().blankN(blank.index),
              size: String(Math.max(6, Math.min(24, longest + 2))),
            });
            field.addEventListener('input', function () { answers[q.id][blank.index] = field.value; });
          }
          return field;
        };
        var blanks = {};
        (q.blanks || []).forEach(function (b) { blanks[b.index] = b; });
        var used = {};
        var sentence = el('p', { class: 'blank-sentence' });
        splitTemplate(q.template).forEach(function (part) {
          if (part.text !== undefined) { sentence.appendChild(document.createTextNode(part.text)); return; }
          var b = blanks[part.blank];
          if (!b || used[part.blank]) { sentence.appendChild(document.createTextNode('____')); return; }
          used[part.blank] = true;
          sentence.appendChild(makeField(b));
        });
        if (sentence.childNodes.length > 0) wrap.appendChild(sentence);
        // Spazi non presenti nel testo: campi a parte, numerati.
        (q.blanks || []).forEach(function (b) {
          if (used[b.index]) return;
          wrap.appendChild(el('label', { class: 'blank-row' }, [quizLabels().blankN(b.index) + ': ', makeField(b)]));
        });
        if (bank) {
          var chips = el('p', { class: 'blank-bank' }, [el('span', { class: 'blank-bank-label' }, [quizLabels().wordBank + ': '])]);
          bank.forEach(function (w) { chips.appendChild(el('span', { class: 'blank-chip' }, [w])); });
          wrap.appendChild(chips);
        }
        break;
      }
      default:
        wrap.appendChild(el('p', {}, ['Tipo di domanda non supportato nel player: ' + q.type]));
    }
    return wrap;
  }

  global.Renderers = { renderBlock: renderBlock, renderAssessment: renderAssessment, showQuestionResults: showQuestionResults, splitTemplate: splitTemplate, renderVideoFirstLesson: renderVideoFirstLesson, renderPillolaLesson: renderPillolaLesson, renderPillolaInterattivaLesson: renderPillolaInterattivaLesson };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.Renderers;
  }
})(typeof window !== 'undefined' ? window : this);
