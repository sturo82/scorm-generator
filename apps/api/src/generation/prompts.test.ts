import { describe, it, expect } from 'vitest';
import type { Brief } from '@scorm/contracts';
import { systemPrompt, formatContext, outlinePrompt, assessmentPrompt } from './prompts.js';
import type { RetrievedChunk } from '../knowledge/retrieval.service.js';

const brief: Brief = {
  title: 'Sicurezza sul lavoro',
  learningObjectives: ['Riconoscere i rischi', 'Usare i DPI'],
  targetAudience: 'Neoassunti',
  level: 'beginner',
  estimatedDurationMinutes: 90,
  language: 'it',
  requestedAssessments: ['final'],
  constraints: ['Niente video lunghi'],
  brandIds: [],
};

describe('systemPrompt', () => {
  it('include il tono di brand quando presente (precedenza brand)', () => {
    const p = systemPrompt({ tone: 'formale e rassicurante', dosAndDonts: ['Evita gergo'] });
    expect(p).toContain('formale e rassicurante');
    expect(p).toContain('Evita gergo');
  });

  it('funziona senza voice', () => {
    expect(systemPrompt()).toContain('instructional designer');
  });
});

describe('formatContext', () => {
  it('numera le fonti con riferimento a documento e sezione', () => {
    const chunks: RetrievedChunk[] = [
      { text: 'Gli estintori...', score: 0.9, citation: { documentId: 'd1', documentName: 'Manuale', section: 'Antincendio' } },
    ];
    const out = formatContext(chunks);
    expect(out).toContain('[1]');
    expect(out).toContain('Manuale — Antincendio');
    expect(out).toContain('Gli estintori');
  });

  it('restituisce stringa vuota senza chunk', () => {
    expect(formatContext([])).toBe('');
  });
});

describe('outlinePrompt', () => {
  it('include i dati chiave del brief', () => {
    const p = outlinePrompt(brief, '');
    expect(p).toContain('Sicurezza sul lavoro');
    expect(p).toContain('Riconoscere i rischi');
    expect(p).toContain('Neoassunti');
    expect(p).toContain('Niente video lunghi');
  });
});

describe('assessmentPrompt', () => {
  it('distingue test finale e intermedio', () => {
    expect(assessmentPrompt({ courseTitle: 'C', scope: 'final', focus: 'X', language: 'it', context: '' })).toContain('finale');
    expect(assessmentPrompt({ courseTitle: 'C', scope: 'intermediate', focus: 'X', language: 'it', context: '' })).toContain('intermedio');
  });
});
