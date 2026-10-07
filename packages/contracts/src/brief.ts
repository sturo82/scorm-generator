import { z } from 'zod';
import { Id, LanguageCode } from './primitives.js';

/**
 * Brief iniziale del corso (Requisito 2). Input strutturato che guida la
 * generazione AI di outline e contenuti.
 */

export const ProficiencyLevel = z.enum(['beginner', 'intermediate', 'advanced']);
export type ProficiencyLevel = z.infer<typeof ProficiencyLevel>;

/** Tipi di test richiesti nel corso (Requisito 2.1 / 6.3). */
export const RequestedAssessment = z.enum(['intermediate', 'final']);
export type RequestedAssessment = z.infer<typeof RequestedAssessment>;

export const Brief = z.object({
  title: z.string().min(1),
  learningObjectives: z.array(z.string().min(1)).min(1),
  targetAudience: z.string().min(1),
  level: ProficiencyLevel,
  /** Durata stimata del corso in minuti. */
  estimatedDurationMinutes: z.number().int().positive(),
  language: LanguageCode,
  /** Tono di voce desiderato; il tono di brand ha precedenza se presente. */
  tone: z.string().optional(),
  /** Numero indicativo di lezioni desiderate. */
  desiredLessonCount: z.number().int().positive().optional(),
  requestedAssessments: z.array(RequestedAssessment).default([]),
  constraints: z.array(z.string()).default([]),
  /** Brand associati al corso già in fase di brief (Requisito 2.5). */
  brandIds: z.array(Id).default([]),
  /**
   * Documenti della knowledge base da usare per la generazione (whitelist). Se
   * vuoto, la generazione usa tutta la knowledge pertinente per similarità
   * (comportamento di default); se valorizzato, limita il RAG a questi documenti.
   */
  knowledgeDocIds: z.array(Id).default([]),
  /**
   * Se true (default), dopo la generazione dei contenuti di una lezione vengono
   * generate automaticamente le immagini illustrative. Disattivabile per
   * risparmiare tempo/budget (le immagini restano generabili manualmente).
   */
  autoGenerateImages: z.boolean().default(true),
  /**
   * Corso "video-first": se true, OGNI lezione è incentrata su un video (con un
   * segnaposto video da riempire caricando il file) affiancato da elementi
   * dinamici e quiz. Si può comunque marcare singole lezioni come video-first
   * anche quando questo è false (vedi flag per-lezione).
   */
  videoFirst: z.boolean().default(false),
});
export type Brief = z.infer<typeof Brief>;

/**
 * Variante "draft" del brief: tutti i campi opzionali per consentire il
 * salvataggio di bozze parziali (Requisito 2.4). I default sensati e i campi
 * mancanti vengono gestiti a livello applicativo (Requisito 2.3).
 */
export const BriefDraft = Brief.partial();
export type BriefDraft = z.infer<typeof BriefDraft>;
