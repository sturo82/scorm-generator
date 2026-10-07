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
  // quindi resolveMedia lo restituisce tale e quale.
  var CORE_CTX = {
    resolveMedia: function (m) {
      return m && m.storageKey ? m.storageKey : null;
    },
  };

  function renderBlock(block) {
    // Tutti i tipi sono gestiti dal renderer condiviso (window.RenderCore):
    // un'unica implementazione per anteprima ed export.
    var core = global.RenderCore;
    if (core && core.isHandledByCore(block.type)) {
      return core.renderBlockDom(block, CORE_CTX);
    }
    var fn = fallbackRenderers[block.type];
    if (!fn) return el('div', { class: 'block unknown' }, ['[tipo non supportato: ' + block.type + ']']);
    return fn(block.payload || {});
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
    var submit = el('button', { class: 'assessment-submit', type: 'button' }, ['Invia risposte']);
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
          ? [{ id: 'true', text: 'Vero' }, { id: 'false', text: 'Falso' }]
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
        var text = el('input', { type: 'text', class: 'text-answer', 'aria-label': q.prompt || 'Risposta' });
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
          var inp = el('input', { type: 'text', 'aria-label': 'Spazio ' + blank.index, style: 'width:10em' });
          inp.addEventListener('input', function () { answers[q.id][blank.index] = inp.value; });
          wrap.appendChild(el('label', { class: 'blank-row' }, ['Spazio ' + blank.index + ': ', inp]));
        });
        break;
      }
      default:
        wrap.appendChild(el('p', {}, ['Tipo di domanda non supportato nel player: ' + q.type]));
    }
    return wrap;
  }

  global.Renderers = { renderBlock: renderBlock, renderAssessment: renderAssessment };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.Renderers;
  }
})(typeof window !== 'undefined' ? window : this);
