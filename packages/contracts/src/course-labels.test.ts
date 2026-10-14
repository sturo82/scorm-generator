import { describe, it, expect } from 'vitest';
import { courseLabels } from './course-labels.js';

describe('courseLabels', () => {
  it('restituisce le etichette inglesi per "en" e varianti regionali', () => {
    expect(courseLabels('en').courseOverview).toBe('Course overview');
    expect(courseLabels('en-US').next).toBe('Next');
    expect(courseLabels('EN').prev).toBe('Previous');
  });

  it('restituisce le etichette italiane per "it"', () => {
    expect(courseLabels('it').courseOverview).toBe('Panoramica del corso');
    expect(courseLabels('it').next).toBe('Avanti');
    expect(courseLabels('it').prev).toBe('Precedente');
  });

  it('usa l’inglese come fallback per lingue non gestite o assenti', () => {
    expect(courseLabels('fr').programme).toBe('Course programme');
    expect(courseLabels(undefined).programme).toBe('Course programme');
    expect(courseLabels('').next).toBe('Next');
  });

  it('interpola numeri e applica singolare/plurale', () => {
    const en = courseLabels('en');
    expect(en.moduleN(3)).toBe('Module 3');
    expect(en.stepStatus(2, 7)).toBe('2 of 7');
    expect(en.conceptStatus(1, 4)).toBe('Concept 1 of 4');
    expect(en.lessonCount(1)).toBe('1 lesson');
    expect(en.lessonCount(5)).toBe('5 lessons');
    expect(en.moduleWord(1)).toBe('Module');
    expect(en.moduleWord(2)).toBe('Modules');
    expect(en.assessmentGateIntro(80)).toContain('80%');

    const it = courseLabels('it');
    expect(it.moduleN(3)).toBe('Modulo 3');
    expect(it.lessonCount(1)).toBe('1 lezione');
    expect(it.lessonCount(5)).toBe('5 lezioni');
    expect(it.stepStatus(2, 7)).toBe('2 di 7');
  });
});
