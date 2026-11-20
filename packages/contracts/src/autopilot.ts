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
  /** `insufficient_credits`: il saldo non basta, si risolve ricaricando e riprendendo. */
  errorCode?: 'insufficient_credits';
  progress: {
    lessons: { done: number; total: number };
    /** Lezioni in ordine, con lo stato: alimentano l'animazione della schermata. */
    lessonItems: Array<{ title: string; format: string; done: boolean }>;
    tests: { done: number; total: number };
    cover: boolean;
    /** Video animati: pronti, in lavorazione e ancora da avviare. */
    videos: { done: number; processing: number; pending: number };
    narration: { done: number; total: number };
  };
}

/** Corso nella dashboard: copertina, avanzamento e cosa ha speso. */
export interface DashboardCourse {
  id: string;
  title: string;
  description: string;
  language: string;
  status: 'DRAFT' | 'IN_REVIEW' | 'APPROVED';
  coverImageUrl?: string;
  coverPosition?: number;
  updatedAt: string;
  createdAt: string;
  modules: number;
  lessons: number;
  /** Lezioni con i contenuti già generati. */
  lessonsReady: number;
  /** Video presenti nelle lezioni (caricati o generati). */
  videos: number;
  /** La generazione automatica è in corso o in attesa. */
  generating: boolean;
  /** Ci sono problemi da risolvere dopo la generazione automatica. */
  needsAttention: boolean;
  /** Crediti addebitati finora a questo corso. */
  credits: number;
}

/** Riepilogo della dashboard: numeri, corsi recenti e consumo di crediti. */
export interface DashboardSummary {
  totals: {
    courses: number;
    byStatus: { draft: number; inReview: number; approved: number };
    lessons: number;
    lessonsReady: number;
    brands: number;
    knowledgeDocs: number;
  };
  media: {
    /** Video nelle lezioni dei corsi. */
    lessonVideos: number;
    /** Video nella libreria: caricati, da slide, collegati da piattaforme esterne. */
    library: { total: number; uploaded: number; fromSlides: number; external: number };
    images: number;
    narrations: number;
  };
  credits: { spentThisMonth: number; spentTotal: number };
  recentCourses: DashboardCourse[];
}
