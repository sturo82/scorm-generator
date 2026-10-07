import { describe, it, expect } from 'vitest';
import { loadRuntimeAsset } from './load-asset.js';

const Scoring = loadRuntimeAsset('scoring.js') as {
  gradeQuestion: (q: unknown, a: unknown) => boolean;
  gradeAssessment: (a: unknown, answers: unknown) => { raw: number; max: number; scaled: number; passed: boolean };
};

describe('scoring.gradeQuestion', () => {
  it('single_choice', () => {
    const q = { type: 'single_choice', choices: [{ id: 'a', correct: true }, { id: 'b' }] };
    expect(Scoring.gradeQuestion(q, 'a')).toBe(true);
    expect(Scoring.gradeQuestion(q, 'b')).toBe(false);
  });

  it('multiple_choice come insieme', () => {
    const q = { type: 'multiple_choice', choices: [{ id: 'a', correct: true }, { id: 'b', correct: true }, { id: 'c' }] };
    expect(Scoring.gradeQuestion(q, ['b', 'a'])).toBe(true);
    expect(Scoring.gradeQuestion(q, ['a'])).toBe(false);
  });

  it('true_false', () => {
    const q = { type: 'true_false', answer: true };
    expect(Scoring.gradeQuestion(q, true)).toBe(true);
    expect(Scoring.gradeQuestion(q, false)).toBe(false);
  });

  it('short_text case-insensitive di default', () => {
    const q = { type: 'short_text', acceptedAnswers: ['Roma'] };
    expect(Scoring.gradeQuestion(q, 'roma')).toBe(true);
  });

  it('matching e ordering', () => {
    const match = { type: 'matching', pairs: [{ id: 'p', left: 'A', right: '1' }] };
    expect(Scoring.gradeQuestion(match, { p: '1' })).toBe(true);
    expect(Scoring.gradeQuestion(match, { p: '2' })).toBe(false);
    const order = { type: 'ordering', items: [{ id: 'i1', correctPosition: 1 }, { id: 'i2', correctPosition: 2 }] };
    expect(Scoring.gradeQuestion(order, { i1: 1, i2: 2 })).toBe(true);
    expect(Scoring.gradeQuestion(order, { i1: 2, i2: 1 })).toBe(false);
  });

  it('fill_blank', () => {
    const q = { type: 'fill_blank', template: '{{1}}', blanks: [{ index: 1, accepted: ['x'] }] };
    expect(Scoring.gradeQuestion(q, { 1: 'X' })).toBe(true);
    expect(Scoring.gradeQuestion(q, { 1: 'y' })).toBe(false);
  });
});

describe('scoring.gradeAssessment', () => {
  it('calcola raw/max/scaled e superamento su mastery', () => {
    const assessment = {
      masteryScore: 0.5,
      questions: [
        { id: 'q1', type: 'true_false', answer: true, points: 1 },
        { id: 'q2', type: 'single_choice', choices: [{ id: 'a', correct: true }], points: 3 },
      ],
    };
    const result = Scoring.gradeAssessment(assessment, { q1: true, q2: 'a' });
    expect(result.raw).toBe(4);
    expect(result.max).toBe(4);
    expect(result.scaled).toBe(1);
    expect(result.passed).toBe(true);
  });

  it('fallisce sotto la soglia di mastery', () => {
    const assessment = {
      masteryScore: 0.8,
      questions: [
        { id: 'q1', type: 'true_false', answer: true, points: 1 },
        { id: 'q2', type: 'true_false', answer: true, points: 1 },
      ],
    };
    const result = Scoring.gradeAssessment(assessment, { q1: true, q2: false });
    expect(result.scaled).toBe(0.5);
    expect(result.passed).toBe(false);
  });
});
