import { z } from 'zod';
import { Assessment } from './assessment.js';
import { Block } from './blocks.js';
import { EditorialMeta, Id, LanguageCode } from './primitives.js';

/**
 * Gerarchia dei contenuti del corso (Requisito 4.2):
 * Course -> Module -> Lesson -> Block, con Assessment a livello di corso
 * (scope intermediate/final).
 */

export const Lesson = z.object({
  id: Id,
  title: z.string().min(1),
  objectives: z.array(z.string()).default([]),
  blocks: z.array(Block).default([]),
  /** Chiave/URL della narrazione audio (TTS) della lezione, se generata. */
  narrationKey: z.string().optional(),
  /** Lezione video-first: pilota il layout a 2 colonne nel player/anteprima. */
  videoFirst: z.boolean().default(false),
  editorial: EditorialMeta.default({}),
});
export type Lesson = z.infer<typeof Lesson>;

export const Module = z.object({
  id: Id,
  title: z.string().min(1),
  summary: z.string().optional(),
  /** Obiettivi didattici del modulo (sintesi degli obiettivi delle lezioni). */
  objectives: z.array(z.string()).default([]),
  /** Chiave/URL dell'immagine di copertina del modulo, se generata. */
  coverImageKey: z.string().optional(),
  lessons: z.array(Lesson).default([]),
  editorial: EditorialMeta.default({}),
});
export type Module = z.infer<typeof Module>;

export const Course = z.object({
  id: Id,
  tenantId: Id,
  title: z.string().min(1),
  description: z.string().default(''),
  language: LanguageCode,
  /** Chiave/URL dell'immagine di copertina del corso, se generata. */
  coverImageKey: z.string().optional(),
  /**
   * Stile delle micro-interazioni (flashcard, quiz, accordion, hotspot) del
   * corso. 'sober' = transizioni morbide e sobrie (default enterprise);
   * 'lively' = animazioni più espressive (bounce, pulse, celebrazione quiz).
   * Entrambi rispettano prefers-reduced-motion. Propagato identico ad anteprima
   * web e player SCORM tramite l'attributo data-motion sul contenitore.
   */
  interactionStyle: z.enum(['sober', 'lively']).default('sober'),
  /** Brand primario del corso: pilota colori/logo/accenti (anteprima + export). */
  primaryBrandId: z.string().optional(),
  /**
   * Docente/relatore del corso, mostrato nell'header sempre visibile (anteprima
   * + player SCORM). Nome obbligatorio se presente; ruolo e foto opzionali.
   */
  instructor: z
    .object({
      name: z.string().min(1),
      role: z.string().optional(),
      /** Chiave/URL dell'immagine del docente, se presente. */
      avatarKey: z.string().optional(),
    })
    .optional(),
  modules: z.array(Module).default([]),
  assessments: z.array(Assessment).default([]),
  editorial: EditorialMeta.default({}),
});
export type Course = z.infer<typeof Course>;

/**
 * Outline del corso: struttura leggera generata nella prima fase AI e sottoposta
 * a revisione prima di generare i contenuti (Requisito 4.1).
 */
export const LessonOutline = z.object({
  title: z.string().min(1),
  objectives: z.array(z.string()).default([]),
  /** Tipi di interazione suggeriti per la lezione. */
  suggestedBlockTypes: z.array(z.string()).default([]),
  /**
   * Lezione "video-first": incentrata su un video (segnaposto da riempire) con
   * elementi dinamici e quiz affiancati. L'AI può proporlo dove ha senso; è
   * forzato a true per tutte le lezioni se il brief è video-first.
   */
  videoFirst: z.boolean().default(false),
});
export const ModuleOutline = z.object({
  title: z.string().min(1),
  summary: z.string().optional(),
  lessons: z.array(LessonOutline).min(1),
  /** Indica se il modulo prevede un test intermedio. */
  hasIntermediateAssessment: z.boolean().default(false),
});
export const CourseOutline = z.object({
  title: z.string().min(1),
  description: z.string().default(''),
  language: LanguageCode,
  modules: z.array(ModuleOutline).min(1),
  hasFinalAssessment: z.boolean().default(false),
});
export type CourseOutline = z.infer<typeof CourseOutline>;
export type ModuleOutline = z.infer<typeof ModuleOutline>;
export type LessonOutline = z.infer<typeof LessonOutline>;
