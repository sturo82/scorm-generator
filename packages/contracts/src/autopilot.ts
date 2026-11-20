import { z } from 'zod';
import { CourseEstimateOptions } from './course-plan.js';

/**
 * Generazione automatica del corso: dopo il preventivo, il server esegue in sequenza struttura,
 * contenuti (con immagini), test, copertina e le componenti scelte nel preventivo. L'utente vede
 * una sola schermata di avanzamento; alla fine il corso è pronto da rivedere.
 */
export const AutopilotPhase = z.enum(['structure', 'review', 'content', 'tests', 'cover', 'extras', 'done']);
export type AutopilotPhase = z.infer<typeof AutopilotPhase>;

export const AutopilotStatus = z.enum(['running', 'paused', 'completed', 'failed', 'cancelled']);
export type AutopilotStatus = z.infer<typeof AutopilotStatus>;

export const StartAutopilot = z.object({
  /** Si ferma dopo la struttura: l'utente la rivede e poi fa ripartire la generazione. */
  reviewStructure: z.boolean().default(false),
  /** Componenti aggiuntive (default: quelle scelte nel preventivo del corso). */
  options: CourseEstimateOptions.partial().optional(),
});
export type StartAutopilot = z.infer<typeof StartAutopilot>;

/** Stato della generazione automatica con l'avanzamento calcolato sul corso. */
export interface AutopilotView {
  status: AutopilotStatus;
  phase: AutopilotPhase;
  reviewStructure: boolean;
  options: CourseEstimateOptions;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  /** Problemi non bloccanti (es. una lezione non generata): si risolvono dal corso. */
  issues: string[];
  error?: string;
  progress: {
    lessons: { done: number; total: number };
    tests: { done: number; total: number };
    cover: boolean;
    /** Video animati: pronti, in lavorazione e ancora da avviare. */
    videos: { done: number; processing: number; pending: number };
    narration: { done: number; total: number };
  };
}
