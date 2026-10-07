/*
 * scoring.js — Valutazione delle domande (Requisito 6.2 / 6.4 / 6.5). Funzioni
 * pure (nessun DOM) che calcolano la correttezza e il punteggio di ciascun tipo
 * di domanda e aggregano il risultato di un assessment. Usato dal runtime dei
 * test per riportare score/success/completion all'LMS via la Run-Time API.
 */
(function (global) {
  'use strict';

  function arraysEqualAsSets(a, b) {
    if (a.length !== b.length) return false;
    var sa = a.slice().sort();
    var sb = b.slice().sort();
    for (var i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
    return true;
  }

  function normalize(s, caseSensitive) {
    s = String(s == null ? '' : s).trim();
    return caseSensitive ? s : s.toLowerCase();
  }

  /** Valuta una singola domanda. `answer` dipende dal tipo. */
  function gradeQuestion(question, answer) {
    switch (question.type) {
      case 'single_choice': {
        var correct = (question.choices || []).filter(function (c) { return c.correct; }).map(function (c) { return c.id; });
        return correct.length === 1 && answer === correct[0];
      }
      case 'multiple_choice': {
        var correctIds = (question.choices || []).filter(function (c) { return c.correct; }).map(function (c) { return c.id; });
        return arraysEqualAsSets(correctIds, Array.isArray(answer) ? answer : []);
      }
      case 'true_false':
        return Boolean(answer) === Boolean(question.answer);
      case 'short_text': {
        var accepted = (question.acceptedAnswers || []).map(function (a) { return normalize(a, question.caseSensitive); });
        return accepted.indexOf(normalize(answer, question.caseSensitive)) !== -1;
      }
      case 'matching': {
        // answer: { pairId: rightValue }
        var okM = true;
        (question.pairs || []).forEach(function (pair) {
          if (!answer || answer[pair.id] !== pair.right) okM = false;
        });
        return okM;
      }
      case 'ordering': {
        // answer: { itemId: position }
        var okO = true;
        (question.items || []).forEach(function (item) {
          if (!answer || Number(answer[item.id]) !== item.correctPosition) okO = false;
        });
        return okO;
      }
      case 'fill_blank': {
        // answer: { index: value }
        var okF = true;
        (question.blanks || []).forEach(function (blank) {
          var given = normalize(answer ? answer[blank.index] : '', false);
          var accepts = (blank.accepted || []).map(function (a) { return normalize(a, false); });
          if (accepts.indexOf(given) === -1) okF = false;
        });
        return okF;
      }
      case 'interactive':
        // La correttezza è decisa dal renderer interattivo (passata in answer).
        return Boolean(answer);
      default:
        return false;
    }
  }

  /**
   * Valuta un intero assessment. `answers` è una mappa questionId -> answer.
   * Restituisce punteggio grezzo/max, scaled 0..1, superamento e completamento.
   */
  function gradeAssessment(assessment, answers) {
    var raw = 0;
    var max = 0;
    var perQuestion = [];
    (assessment.questions || []).forEach(function (q) {
      var points = typeof q.points === 'number' ? q.points : 1;
      max += points;
      var correct = gradeQuestion(q, answers ? answers[q.id] : undefined);
      if (correct) raw += points;
      perQuestion.push({ id: q.id, correct: correct, points: correct ? points : 0 });
    });
    var scaled = max > 0 ? raw / max : 0;
    var mastery = typeof assessment.masteryScore === 'number' ? assessment.masteryScore : 0.8;
    return {
      raw: raw,
      max: max,
      scaled: scaled,
      passed: scaled >= mastery,
      completed: true,
      perQuestion: perQuestion,
    };
  }

  var api = { gradeQuestion: gradeQuestion, gradeAssessment: gradeAssessment };
  global.Scoring = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
