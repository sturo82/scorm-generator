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
