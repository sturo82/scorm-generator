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
    en: { submit: 'Submit answers', yes: 'True', no: 'False', answer: 'Answer', blankN: function (i) { return 'Blank ' + i; } },
    it: { submit: 'Invia risposte', yes: 'Vero', no: 'Falso', answer: 'Risposta', blankN: function (i) { return 'Spazio ' + i; } },
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
  function renderAssessment(assessment, options) {
    options = options || {};
    var answers = {};
    var container = el('div', { class: 'assessment' });
    container.appendChild(el('h2', { class: 'assessment-title' }, [assessment.title || 'Test']));

    (assessment.questions || []).forEach(function (q, qi) {
      var fieldset = el('fieldset', { class: 'question' });
      fieldset.appendChild(el('legend', {}, [(qi + 1) + '. ' + (q.prompt || '')]));
      fieldset.appendChild(buildQuestionInput(q, answers));
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
        opts.forEach(function (c) {
          var oid = name + '_' + c.id;
          var input = el('input', { type: 'radio', name: name, id: oid, value: c.id });
          input.addEventListener('change', function () {
            answers[q.id] = q.type === 'true_false' ? c.id === 'true' : c.id;
          });
          wrap.appendChild(el('label', { class: 'opt', for: oid }, [input, ' ' + c.text]));
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
          wrap.appendChild(el('label', { class: 'opt', for: cid }, [input, ' ' + c.text]));
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
        var rights = (q.pairs || []).map(function (p) { return p.right; });
        (q.pairs || []).forEach(function (pair) {
          var sel = el('select', { 'aria-label': pair.left });
          sel.appendChild(el('option', { value: '' }, ['—']));
          rights.forEach(function (r) { sel.appendChild(el('option', { value: r }, [r])); });
          sel.addEventListener('change', function () { answers[q.id][pair.id] = sel.value; });
          wrap.appendChild(el('label', { class: 'match-row' }, [pair.left + ' ', sel]));
        });
        break;
      }
      case 'ordering': {
        answers[q.id] = {};
        (q.items || []).forEach(function (item) {
          var num = el('input', { type: 'number', min: '1', 'aria-label': item.label, style: 'width:3.5em' });
          num.addEventListener('input', function () { answers[q.id][item.id] = Number(num.value); });
          wrap.appendChild(el('label', { class: 'order-row' }, [num, ' ' + item.label]));
        });
        break;
      }
      case 'fill_blank': {
        answers[q.id] = {};
        (q.blanks || []).forEach(function (blank) {
          var inp = el('input', { type: 'text', 'aria-label': quizLabels().blankN(blank.index), style: 'width:10em' });
          inp.addEventListener('input', function () { answers[q.id][blank.index] = inp.value; });
          wrap.appendChild(el('label', { class: 'blank-row' }, [quizLabels().blankN(blank.index) + ': ', inp]));
        });
        break;
      }
      default:
        wrap.appendChild(el('p', {}, ['Tipo di domanda non supportato nel player: ' + q.type]));
    }
    return wrap;
  }

  global.Renderers = { renderBlock: renderBlock, renderAssessment: renderAssessment, renderVideoFirstLesson: renderVideoFirstLesson, renderPillolaLesson: renderPillolaLesson, renderPillolaInterattivaLesson: renderPillolaInterattivaLesson };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.Renderers;
  }
})(typeof window !== 'undefined' ? window : this);
