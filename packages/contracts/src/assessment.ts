import { z } from 'zod';
import { EditorialMeta, Id } from './primitives.js';

/**
 * Test e valutazioni (Requisito 6). Supporta domande classiche e valutazioni
 * interattive; test intermedi (per modulo) e finale (di corso).
 */

export const QuestionType = z.enum([
  'single_choice',
  'multiple_choice',
  'true_false',
  'short_text',
  'matching',
  'ordering',
  'fill_blank',
  // Valutazioni interattive derivate dai Block (Requisito 6.2).
  'interactive',
]);
export type QuestionType = z.infer<typeof QuestionType>;

export const Choice = z.object({
  id: Id,
  text: z.string(),
  correct: z.boolean().default(false),
});

export const MatchingPair = z.object({
  id: Id,
  left: z.string(),
  right: z.string(),
});

export const OrderingItem = z.object({
  id: Id,
  label: z.string(),
  correctPosition: z.number().int().positive(),
});

/** Campo comune a tutte le domande. */
const questionBase = {
  id: Id,
  prompt: z.string().min(1),
  points: z.number().nonnegative().default(1),
  feedbackCorrect: z.string().optional(),
  feedbackIncorrect: z.string().optional(),
  editorial: EditorialMeta.default({}),
};

export const Question = z.discriminatedUnion('type', [
  z.object({ ...questionBase, type: z.literal('single_choice'), choices: z.array(Choice).min(2) }),
  z.object({
    ...questionBase,
    type: z.literal('multiple_choice'),
    choices: z.array(Choice).min(2),
  }),
  z.object({ ...questionBase, type: z.literal('true_false'), answer: z.boolean() }),
  z.object({
    ...questionBase,
    type: z.literal('short_text'),
    acceptedAnswers: z.array(z.string()).min(1),
    caseSensitive: z.boolean().default(false),
  }),
  z.object({ ...questionBase, type: z.literal('matching'), pairs: z.array(MatchingPair).min(2) }),
  z.object({ ...questionBase, type: z.literal('ordering'), items: z.array(OrderingItem).min(2) }),
  z.object({
    ...questionBase,
    type: z.literal('fill_blank'),
    /** Testo con segnaposto {{1}}, {{2}}... per gli spazi da compilare. */
    template: z.string(),
    blanks: z.array(z.object({ index: z.number().int().positive(), accepted: z.array(z.string()) })),
    /**
     * Parole tra cui scegliere (facoltative): le risposte giuste più qualche distrattore. Se presenti
     * ogni spazio diventa un menu; altrimenti la parola si scrive.
     */
    options: z.array(z.string()).optional(),
  }),
  z.object({
    ...questionBase,
    type: z.literal('interactive'),
    /** Riferimento al Block valutabile che implementa l'interazione. */
    blockId: Id,
  }),
]);
export type Question = z.infer<typeof Question>;

export const AssessmentScope = z.enum(['intermediate', 'final']);
export type AssessmentScope = z.infer<typeof AssessmentScope>;

export const Assessment = z.object({
  id: Id,
  title: z.string().min(1),
  scope: AssessmentScope,
  /** Modulo di riferimento per i test intermedi (Requisito 6.3). */
  moduleId: Id.optional(),
  questions: z.array(Question).min(1),
  /** Soglia di superamento 0..1 (Requisito 6.4). */
  masteryScore: z.number().min(0).max(1).default(0.8),
  maxAttempts: z.number().int().positive().optional(),
  shuffleQuestions: z.boolean().default(false),
  shuffleAnswers: z.boolean().default(false),
  editorial: EditorialMeta.default({}),
});
export type Assessment = z.infer<typeof Assessment>;

/** Segnaposto degli spazi accettati in ingresso: {{1}}, [1], [BLANK_1], ___ (questi ultimi in sequenza). */
const BLANK_PLACEHOLDER = /\{\{\s*(\d+)\s*\}\}|\[\s*(?:blank[\s_-]*)?(\d+)\s*\]|_{3,}/gi;

/**
 * Sistema e controlla un test generato dall'AI prima di salvarlo.
 * - Riporta i segnaposto degli spazi al formato del contratto ({{n}}).
 * - Completa le parole tra cui scegliere con le risposte giuste e toglie i doppioni.
 * Restituisce anche i problemi che rendono una domanda impossibile da rispondere correttamente
 * (va rigenerata): scelta singola senza esattamente una risposta giusta, posizioni del riordino che
 * non sono 1..n, spazi assenti dal testo o senza risposte, abbinamenti con descrizioni ripetute.
 */
export function tidyAssessment(input: Assessment): { assessment: Assessment; problems: string[] } {
  const problems: string[] = [];
  const questions = input.questions.map((q, i): Question => {
    const n = i + 1;
    switch (q.type) {
      case 'single_choice': {
        const right = q.choices.filter((c) => c.correct).length;
        if (right !== 1) problems.push(`domanda ${n}: scelta singola con ${right} risposte giuste`);
        return q;
      }
      case 'multiple_choice': {
        if (!q.choices.some((c) => c.correct)) problems.push(`domanda ${n}: scelta multipla senza risposte giuste`);
        return q;
      }
      case 'matching': {
        const rights = q.pairs.map((p) => p.right.trim().toLowerCase());
        if (new Set(rights).size !== rights.length) problems.push(`domanda ${n}: abbinamento con descrizioni ripetute`);
        return q;
      }
      case 'ordering': {
        const pos = q.items.map((it) => it.correctPosition).sort((a, b) => a - b);
        if (pos.some((p, k) => p !== k + 1)) problems.push(`domanda ${n}: posizioni del riordino non valide`);
        return q;
      }
      case 'fill_blank': {
        let seq = 0;
        const template = q.template.replace(BLANK_PLACEHOLDER, (_m, a?: string, b?: string) => {
          seq++;
          return `{{${a ?? b ?? seq}}}`;
        });
        const inText = new Set([...template.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
        if (q.blanks.length === 0) problems.push(`domanda ${n}: completamento senza spazi`);
        for (const b of q.blanks) {
          if (!inText.has(b.index)) problems.push(`domanda ${n}: lo spazio ${b.index} non compare nel testo`);
          if (!b.accepted.some((a) => a.trim())) problems.push(`domanda ${n}: lo spazio ${b.index} non ha risposte`);
        }
        let options = q.options?.map((o) => o.trim()).filter(Boolean);
        if (options && options.length > 0) {
          for (const b of q.blanks) {
            const first = b.accepted.find((a) => a.trim());
            const has = b.accepted.some((a) => options!.some((o) => o.toLowerCase() === a.trim().toLowerCase()));
            if (first && !has) options.push(first.trim());
          }
          options = options.filter((o, k) => options!.findIndex((x) => x.toLowerCase() === o.toLowerCase()) === k);
          if (options.length < 2) options = undefined;
        } else options = undefined;
        return { ...q, template, ...(options ? { options } : { options: undefined }) };
      }
      default:
        return q;
    }
  });
  return { assessment: { ...input, questions }, problems };
}
