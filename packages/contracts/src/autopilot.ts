import { z } from 'zod';
import { CourseEstimateOptions } from './course-plan.js';

/**
 * Generazione automatica del corso: dopo il preventivo, il server esegue in sequenza struttura,
 * contenuti (con immagini), test, copertina e le componenti scelte nel preventivo. L'utente vede
 * una sola schermata di avanzamento; alla fine il corso è pronto da rivedere.
 */
export const AutopilotPhase = z.enum([
  'structure',
  'review',
  'content',
  'tests',
  'cover',
  'extras',
  // Percorso "da slide": copioni, revisione, clip con l'avatar, montaggio della lezione.
  'scripts',
  'scripts_review',
  'clips',
  'lesson',
  'done',
]);
export type AutopilotPhase = z.infer<typeof AutopilotPhase>;

export const AutopilotStatus = z.enum(['running', 'paused', 'completed', 'failed', 'cancelled']);
export type AutopilotStatus = z.infer<typeof AutopilotStatus>;

/** Scelte del percorso "da slide": le slide sono già state caricate (`importId`). */
export const StartSlidesAutopilot = z.object({
  importId: z.string().min(1),
  /** Id del LOOK HeyGen (non del gruppo). */
  avatarId: z.string().min(1),
  avatarType: z.enum(['photo', 'studio', 'digital_twin']).default('digital_twin'),
  engine: z.enum(['avatar_iii', 'avatar_iv', 'avatar_v']).optional(),
  voiceId: z.string().min(1).optional(),
  /** Documenti della knowledge con cui arricchire i copioni. */
  knowledgeDocIds: z.array(z.string()).max(20).default([]),
  /** Si ferma dopo i copioni per la revisione (di default sì: le clip con l'avatar si pagano). */
  reviewScripts: z.boolean().default(true),
  /** Titolo del modulo e della lezione creati. */
  moduleTitle: z.string().trim().min(1).max(200).optional(),
  /** Suddivide il video in sezioni, ciascuna con il suo quiz. */
  sections: z.boolean().default(false),
});
export type StartSlidesAutopilot = z.infer<typeof StartSlidesAutopilot>;

export const StartAutopilot = z.object({
  /** Si ferma dopo la struttura: l'utente la rivede e poi fa ripartire la generazione. */
  reviewStructure: z.boolean().default(false),
  /** Componenti aggiuntive (default: quelle scelte nel preventivo del corso). */
  options: CourseEstimateOptions.partial().optional(),
  /** Percorso "da slide": se presente, al posto di struttura e contenuti si generano copioni, clip e lezione. */
  slides: StartSlidesAutopilot.optional(),
});
export type StartAutopilot = z.infer<typeof StartAutopilot>;



/** Stato della generazione automatica con l'avanzamento calcolato sul corso. */
export interface AutopilotView {
  /** `slides` = percorso da slide (copioni, clip avatar, montaggio). */
  kind: 'course' | 'slides';
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
  /** Solo per il percorso da slide. */
  slides?: {
    /** 'videos' = percorso da video (ogni elemento è un video). */
    source?: 'slides' | 'videos';
    reviewScripts: boolean;
    slides: number;
    scripts: 'none' | 'running' | 'draft' | 'approved' | 'failed';
    clips: { done: number; total: number; failed: number; minutes?: number };
    lesson: 'none' | 'running' | 'completed' | 'failed';
    /** Perché la generazione si è fermata per la revisione (scelta o problemi trovati). */
    reviewReason?: string;
  };
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
