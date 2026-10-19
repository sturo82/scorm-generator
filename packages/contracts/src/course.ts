import { z } from 'zod';
import { Assessment } from './assessment.js';
import { Block } from './blocks.js';
import { EditorialMeta, Id, LanguageCode } from './primitives.js';

/**
 * Gerarchia dei contenuti del corso (Requisito 4.2):
 * Course -> Module -> Lesson -> Block, con Assessment a livello di corso
 * (scope intermediate/final).
 */

/**
 * Formato didattico di una SINGOLA lezione. È la fonte di verità per-lezione
 * del tipo di contenuto; i flag booleani `videoFirst`/`pillola` restano come
 * derivati (retro-compatibilità con prompt/player esistenti):
 *  - 'pillola'     : micro-learning, contenitore scorrevole a card (hook video
 *                    code-to-video + core + checkpoint + takeaway). → pillola=true.
 *  - 'video_first' : incentrata su UN video portante, layout a 2 colonne. → videoFirst=true.
 *  - 'standard'    : testo + immagini + interazioni (il "completo" classico). → entrambi false.
 * Mappa con CourseFormat a livello di corso: 'standard' ↔ 'completo'.
 */
export const LessonFormat = z.enum(['pillola', 'video_first', 'standard']);
export type LessonFormat = z.infer<typeof LessonFormat>;

/** Deriva i flag booleani storici (videoFirst/pillola) dal formato lezione. */
export function lessonFlagsFromFormat(format: LessonFormat): { videoFirst: boolean; pillola: boolean } {
  return {
    videoFirst: format === 'video_first',
    pillola: format === 'pillola',
  };
}

/** Deriva il formato lezione dai flag booleani storici (pillola ha precedenza). */
export function lessonFormatFromFlags(flags: { videoFirst?: boolean; pillola?: boolean }): LessonFormat {
  if (flags.pillola) return 'pillola';
  if (flags.videoFirst) return 'video_first';
  return 'standard';
}

export const Lesson = z.object({
  id: Id,
  title: z.string().min(1),
  objectives: z.array(z.string()).default([]),
  blocks: z.array(Block).default([]),
  /** Chiave/URL della narrazione audio (TTS) della lezione, se generata. */
  narrationKey: z.string().optional(),
  /**
   * Formato didattico della lezione (fonte di verità per-lezione). Assente nei
   * corsi storici: in tal caso va derivato dai flag con lessonFormatFromFlags.
   */
  format: LessonFormat.optional(),
  /** Lezione video-first: pilota il layout a 2 colonne nel player/anteprima. */
  videoFirst: z.boolean().default(false),
  /**
   * Lezione "pillola": pilota un layout dedicato (contenitore scorrevole con
   * ogni blocco in una card ben definita, contenuto e azioni distinti). Deriva
   * da format === 'pillola' (storicamente da Brief.format === 'pillole').
   */
  pillola: z.boolean().default(false),
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

/** Motore di sintesi vocale (Amazon Polly): economico vs qualità superiore. */
export const SpeechEngine = z.enum(['standard', 'neural']);
export type SpeechEngine = z.infer<typeof SpeechEngine>;

export const Course = z.object({
  id: Id,
  tenantId: Id,
  title: z.string().min(1),
  description: z.string().default(''),
  language: LanguageCode,
  /** Chiave/URL dell'immagine di copertina del corso, se generata. */
  coverImageKey: z.string().optional(),
  /**
   * Punto focale VERTICALE della copertina (0-100, centro=50): applicato come
   * `object-position: 50% <N>%` identico in anteprima web e player SCORM, così
   * l'autore può centrare la copertina ed evitare tagli indesiderati.
   */
  coverPosition: z.number().int().min(0).max(100).default(50),
  /**
   * Stile delle micro-interazioni (flashcard, quiz, accordion, hotspot) del
   * corso. 'sober' = transizioni morbide e sobrie (default enterprise);
   * 'lively' = animazioni più espressive (bounce, pulse, celebrazione quiz).
   * Entrambi rispettano prefers-reduced-motion. Propagato identico ad anteprima
   * web e player SCORM tramite l'attributo data-motion sul contenitore.
   */
  interactionStyle: z.enum(['sober', 'lively']).default('sober'),
  /**
   * Posizione del menu/indice di navigazione: 'side' (sidebar, default) o 'top'
   * (barra in alto espandibile). Applicata identica ad anteprima e player SCORM.
   */
  navPosition: z.enum(['side', 'top']).default('side'),
  /**
   * Preferenza del motore di sintesi vocale (Polly) per la narrazione: 'standard'
   * (economico) o 'neural' (qualità superiore, più costoso). Assente = eredita il
   * default dell'ambiente (SPEECH_ENGINE). Override puntuale possibile al momento
   * della generazione della narrazione.
   */
  speechEngine: SpeechEngine.optional(),
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
   * Formato didattico CONSIGLIATO per la lezione (pillola/video_first/standard):
   * l'LLM lo propone in base alla natura del contenuto, l'autore può cambiarlo.
   * Se il brief forza un formato globale, tutte le lezioni ricevono quello.
   * Assente negli outline storici → si ricade su `videoFirst`/standard.
   */
  format: LessonFormat.optional(),
  /**
   * Lezione "video-first": incentrata su un video (segnaposto da riempire) con
   * elementi dinamici e quiz affiancati. Campo STORICO: la fonte di verità è
   * `format`; resta allineato (true sse format === 'video_first').
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
