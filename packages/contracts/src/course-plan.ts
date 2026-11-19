import { z } from 'zod';
import { CourseFormat, RequestedAssessment, type Brief } from './brief.js';
import { LessonFormat } from './course.js';

/**
 * Piano del corso ricavato dal brief: quante lezioni, quanti moduli e con che formato. È la base
 * sia del preventivo sia della generazione. La struttura generata dall'AI viene riportata a questo
 * piano (vedi enforce dell'outline nell'API), così il preventivo resta un tetto garantito.
 */

/** Lezioni massime di un corso. */
export const MAX_COURSE_LESSONS = 20;

/** Lezioni per modulo usate per fissare il numero massimo di moduli (e quindi di test intermedi). */
export const LESSONS_PER_MODULE = 2;

type PlanBrief = Pick<
  Brief,
  'suggestedLessons' | 'desiredLessonCount' | 'estimatedDurationMinutes' | 'format' | 'videoFirst' | 'lessonFormatDefault' | 'lessonFormatHints'
>;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Numero di lezioni del corso: quelle dell'anteprima, altrimenti quelle desiderate, altrimenti 1 ogni 12 minuti. */
export function plannedLessonCount(b: Partial<PlanBrief>): number {
  const suggested = b.suggestedLessons?.length ?? 0;
  if (suggested > 0) return clamp(suggested, 1, MAX_COURSE_LESSONS);
  if (b.desiredLessonCount && b.desiredLessonCount > 0) return clamp(Math.round(b.desiredLessonCount), 1, MAX_COURSE_LESSONS);
  return clamp(Math.round((b.estimatedDurationMinutes ?? 60) / 12), 2, MAX_COURSE_LESSONS);
}

/** Moduli massimi per un numero di lezioni (1 ogni `LESSONS_PER_MODULE`, arrotondato per eccesso). */
export function plannedModuleCount(lessons: number): number {
  return Math.max(1, Math.ceil(lessons / LESSONS_PER_MODULE));
}

/** Formato imposto a tutte le lezioni dal formato globale del corso, se c'è. */
export function forcedLessonFormat(b: Partial<PlanBrief>): LessonFormat | null {
  if (b.format === 'pillole') return 'pillola';
  if (b.format === 'pillole_interattive') return 'pillola_interattiva';
  if (b.format === 'video_first' || b.videoFirst) return 'video_first';
  return null;
}

/** Formato richiesto per titolo di lezione (confronto senza maiuscole e spazi superflui). */
function hintFor(hints: Record<string, LessonFormat> | undefined, title: string | undefined): LessonFormat | undefined {
  if (!hints || !title) return undefined;
  if (hints[title]) return hints[title];
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const t = norm(title);
  for (const [k, v] of Object.entries(hints)) if (norm(k) === t) return v;
  return undefined;
}

/**
 * Formato di ogni lezione del piano: formato globale, poi eccezione per titolo, poi default del
 * brief. `null` = lo sceglie l'AI: nel preventivo vale come il formato più caro (standard).
 */
export function plannedLessonFormats(b: Partial<PlanBrief>): Array<LessonFormat | null> {
  const n = plannedLessonCount(b);
  const forced = forcedLessonFormat(b);
  return Array.from({ length: n }, (_, i) => forced ?? hintFor(b.lessonFormatHints, b.suggestedLessons?.[i]) ?? b.lessonFormatDefault ?? null);
}

/**
 * Richiesta di preventivo di un corso non ancora creato: gli stessi campi del brief che decidono
 * quante lezioni, di che formato e quanti test (vedi `plannedLessonFormats`).
 */
export const CourseEstimateInput = z.object({
  suggestedLessons: z.array(z.string().min(1).max(300)).max(MAX_COURSE_LESSONS).default([]),
  desiredLessonCount: z.number().int().positive().max(MAX_COURSE_LESSONS).optional(),
  estimatedDurationMinutes: z.number().int().positive().max(2000).optional(),
  format: CourseFormat.default('completo'),
  videoFirst: z.boolean().default(false),
  lessonFormatDefault: LessonFormat.optional(),
  lessonFormatHints: z.record(z.string(), LessonFormat).default({}),
  requestedAssessments: z.array(RequestedAssessment).default([]),
  autoGenerateImages: z.boolean().default(true),
  /** Copertina generata con l'AI. */
  cover: z.boolean().default(true),
});
export type CourseEstimateInput = z.infer<typeof CourseEstimateInput>;

/** Voce del preventivo: `kind` dice cos'è, `format` il formato delle lezioni. */
export interface CourseEstimateLine {
  kind: 'structure' | 'lessons' | 'images' | 'tests' | 'cover';
  format?: LessonFormat;
  quantity: number;
  credits: number | null;
}

/**
 * Preventivo del corso. È un TETTO: l'addebito non lo supera mai (lezioni, moduli, immagini e
 * tentativi sono limitati nel codice). `mode` = `package` con il listino a pacchetti di Manager,
 * `operation` con il listino per operazione (le immagini compaiono come voce a parte).
 */
export interface CourseEstimateView {
  mode: 'package' | 'operation';
  /** False se i crediti non sono attivi: niente da pagare. */
  billed: boolean;
  lines: CourseEstimateLine[];
  total: number;
  priced: boolean;
  lessons: number;
  modules: number;
  tests: number;
  /** Lezioni con formato lasciato all'AI: nel preventivo valgono come lezioni standard. */
  aiChosenFormats: number;
  /** Crediti disponibili del wallet che paga; assente se non leggibile. */
  available?: number;
  /**
   * Prezzo massimo di un singolo pezzo, per i pulsanti (rigenera struttura, una lezione, un test).
   * Una lezione comprende le sue immagini automatiche fino al tetto del formato; `image` è il prezzo
   * di una singola immagine rigenerata.
   */
  prices: {
    structure: number | null;
    test: number | null;
    image: number | null;
    lesson: Record<LessonFormat, number | null>;
  };
}
