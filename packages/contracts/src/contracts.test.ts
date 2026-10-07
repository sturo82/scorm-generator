import { describe, it, expect } from 'vitest';
import {
  CONTRACTS_VERSION,
  Brand,
  Brief,
  Block,
  Assessment,
  Course,
  CourseOutline,
  jsonSchemas,
} from './index.js';

describe('@scorm/contracts', () => {
  it('espone la versione dei contratti', () => {
    expect(CONTRACTS_VERSION).toBe('0.1.0');
  });

  it('valida un Brand completo', () => {
    const brand = Brand.parse({
      id: 'brand_1',
      tenantId: 'tenant_1',
      name: 'Acme',
      assets: { logoPrimaryUrl: 'https://cdn/logo.svg' },
      colors: {
        primary: '#0055FF',
        onPrimary: '#FFFFFF',
        surface: '#FFFFFF',
        onSurface: '#111111',
        success: '#2E7D32',
        warning: '#ED6C02',
        error: '#D32F2F',
      },
      typography: { fontFamilyHeading: 'Inter', fontFamilyBody: 'Inter' },
    });
    expect(brand.name).toBe('Acme');
  });

  it('rifiuta un colore brand non valido', () => {
    const res = Brand.safeParse({
      id: 'b',
      tenantId: 't',
      name: 'X',
      assets: { logoPrimaryUrl: 'u' },
      colors: {
        primary: 'blue',
        onPrimary: '#FFFFFF',
        surface: '#FFFFFF',
        onSurface: '#000000',
        success: '#2E7D32',
        warning: '#ED6C02',
        error: '#D32F2F',
      },
      typography: { fontFamilyHeading: 'Inter', fontFamilyBody: 'Inter' },
    });
    expect(res.success).toBe(false);
  });

  it('applica i default del Brief (array vuoti)', () => {
    const brief = Brief.parse({
      title: 'Sicurezza sul lavoro',
      learningObjectives: ['Riconoscere i rischi'],
      targetAudience: 'Neoassunti',
      level: 'beginner',
      estimatedDurationMinutes: 60,
      language: 'it',
    });
    expect(brief.requestedAssessments).toEqual([]);
    expect(brief.brandIds).toEqual([]);
    expect(brief.constraints).toEqual([]);
  });

  it('discrimina i Block per tipo e valida il payload', () => {
    const block = Block.parse({
      id: 'blk_1',
      type: 'flashcard',
      payload: {
        cards: [
          { id: 'c1', front: { format: 'html', html: '<p>Q</p>' }, back: { format: 'html', html: '<p>A</p>' } },
        ],
      },
    });
    expect(block.type).toBe('flashcard');
    // editorial applicato di default
    expect(block.editorial.status).toBe('draft');
  });

  it('rifiuta un Block con payload incoerente rispetto al tipo', () => {
    const res = Block.safeParse({
      id: 'blk_2',
      type: 'flashcard',
      payload: { pairs: [] }, // payload da dragdrop_match, non valido per flashcard
    });
    expect(res.success).toBe(false);
  });

  it('valida il nuovo tipo sorting_categories', () => {
    const block = Block.parse({
      id: 'blk_sc',
      type: 'sorting_categories',
      payload: {
        prompt: 'Classifica ogni elemento',
        categories: [
          { id: 'dpi', label: 'DPI' },
          { id: 'nodpi', label: 'Non DPI' },
        ],
        items: [
          { id: 'i1', label: 'Casco', categoryId: 'dpi' },
          { id: 'i2', label: 'Sedia', categoryId: 'nodpi' },
        ],
      },
    });
    expect(block.type).toBe('sorting_categories');
  });

  it('valida un Assessment con domanda a scelta singola e mastery di default', () => {
    const assessment = Assessment.parse({
      id: 'as_1',
      title: 'Test finale',
      scope: 'final',
      questions: [
        {
          id: 'q1',
          type: 'single_choice',
          prompt: 'Qual e la risposta?',
          choices: [
            { id: 'a', text: 'A', correct: true },
            { id: 'b', text: 'B' },
          ],
        },
      ],
    });
    expect(assessment.masteryScore).toBe(0.8);
    expect(assessment.questions[0]?.points).toBe(1);
  });

  it('valida un Course annidato', () => {
    const course = Course.parse({
      id: 'crs_1',
      tenantId: 'tenant_1',
      title: 'Corso',
      language: 'it',
      modules: [
        {
          id: 'm1',
          title: 'Modulo 1',
          lessons: [{ id: 'l1', title: 'Lezione 1' }],
        },
      ],
    });
    expect(course.modules[0]?.lessons[0]?.title).toBe('Lezione 1');
    expect(course.description).toBe('');
  });

  it('valida un CourseOutline', () => {
    const outline = CourseOutline.parse({
      title: 'Corso',
      language: 'it',
      modules: [{ title: 'M1', lessons: [{ title: 'L1' }] }],
    });
    expect(outline.hasFinalAssessment).toBe(false);
  });

  it('valida PlanLimits con default illimitati (null)', async () => {
    const { PlanLimits, FeatureFlags, DEFAULT_PLAN_LIMITS } = await import('./plan.js');
    const parsed = PlanLimits.parse({});
    expect(parsed.maxCourses).toBeNull();
    // I preset dei tier sono coerenti.
    expect(DEFAULT_PLAN_LIMITS.ENTERPRISE.maxCourses).toBeNull();
    expect(DEFAULT_PLAN_LIMITS.PREMIUM.maxCourses).toBe(25);
    // I feature flag applicano i default.
    const flags = FeatureFlags.parse({});
    expect(flags.scorm12Export).toBe(true);
  });

  it('genera JSON Schema per la generazione strutturata', () => {
    for (const [name, schema] of Object.entries(jsonSchemas)) {
      expect(schema, name).toBeTypeOf('object');
      expect(JSON.stringify(schema).length).toBeGreaterThan(2);
    }
  });
});
