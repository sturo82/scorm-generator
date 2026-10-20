import { describe, it, expect } from 'vitest';
import { lessonContentInputHash, lessonContentStale } from './lesson-provenance.js';

const base = {
  format: 'pillola',
  objectives: ['Capire X', 'Applicare Y'],
  courseFocus: 'pratico-applicativo',
  tone: 'professionale',
  knowledgeDocIds: ['doc-a', 'doc-b'],
};

describe('lessonContentInputHash', () => {
  it('è deterministico per gli stessi input', () => {
    expect(lessonContentInputHash(base)).toBe(lessonContentInputHash({ ...base }));
  });

  it('è indipendente dall\'ORDINE di obiettivi e documenti', () => {
    const a = lessonContentInputHash(base);
    const b = lessonContentInputHash({
      ...base,
      objectives: ['Applicare Y', 'Capire X'],
      knowledgeDocIds: ['doc-b', 'doc-a'],
    });
    expect(b).toBe(a);
  });

  it('è indifferente a spazi/trim innocui', () => {
    const a = lessonContentInputHash(base);
    const b = lessonContentInputHash({ ...base, format: ' pillola ', tone: 'professionale  ' });
    expect(b).toBe(a);
  });

  it('CAMBIA quando cambia il formato', () => {
    expect(lessonContentInputHash({ ...base, format: 'pillola_interattiva' })).not.toBe(
      lessonContentInputHash(base),
    );
  });

  it('CAMBIA quando cambiano obiettivi, taglio, tono o fonti', () => {
    const h = lessonContentInputHash(base);
    expect(lessonContentInputHash({ ...base, objectives: ['Altro'] })).not.toBe(h);
    expect(lessonContentInputHash({ ...base, courseFocus: 'teorico' })).not.toBe(h);
    expect(lessonContentInputHash({ ...base, tone: 'informale' })).not.toBe(h);
    expect(lessonContentInputHash({ ...base, knowledgeDocIds: ['doc-c'] })).not.toBe(h);
  });

  it('tratta assente/vuoto in modo coerente (courseFocus/tone opzionali)', () => {
    const a = lessonContentInputHash({ format: 'standard', objectives: [] });
    const b = lessonContentInputHash({ format: 'standard', objectives: [], courseFocus: '', tone: null });
    expect(b).toBe(a);
  });
});

describe('lessonContentStale', () => {
  it('impronta assente/null → NON obsoleto (stato ignoto, nessun falso allarme)', () => {
    expect(lessonContentStale(null, 'abc')).toBe(false);
    expect(lessonContentStale(undefined, 'abc')).toBe(false);
    expect(lessonContentStale('', 'abc')).toBe(false);
  });

  it('impronta uguale → non obsoleto; diversa → obsoleto', () => {
    const h = lessonContentInputHash(base);
    expect(lessonContentStale(h, h)).toBe(false);
    expect(lessonContentStale(h, lessonContentInputHash({ ...base, format: 'standard' }))).toBe(true);
  });
});
