import { z } from 'zod';
import { EditorialMeta, Id, MediaRef, RichText } from './primitives.js';

/**
 * Catalogo delle interazioni (Requisito 5). Ogni Block ha un `type` e un
 * `payload` tipizzato. Il payload contiene SOLO dati, nessuno stile: la resa
 * visiva è demandata ai renderer runtime con i token del brand (Requisito 5.3,
 * 7.5). I tipi "valutabili" possono comparire anche come domande interattive
 * negli assessment (vedi assessment.ts).
 */

/** Elenco dei tipi di interazione del catalogo v1. */
export const BlockType = z.enum([
  'rich_text',
  'image_hotspot',
  'accordion_tabs',
  'flashcard',
  'timeline',
  'dragdrop_match',
  'dragdrop_order',
  'click_reveal',
  'branching_scenario',
  'video_checkpoint',
  'carousel_steps',
  'sorting_categories',
]);
export type BlockType = z.infer<typeof BlockType>;

// --- Payload per tipo -------------------------------------------------------

export const RichTextPayload = z.object({
  content: RichText,
  media: z.array(MediaRef).default([]),
});

export const Hotspot = z.object({
  id: Id,
  /** Coordinate relative (0..1) rispetto all'immagine. */
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  label: z.string(),
  content: RichText,
});
export const ImageHotspotPayload = z.object({
  image: MediaRef,
  hotspots: z.array(Hotspot).min(1),
});

export const AccordionTabsPanel = z.object({
  id: Id,
  title: z.string(),
  content: RichText,
});
export const AccordionTabsPayload = z.object({
  variant: z.enum(['accordion', 'tabs']).default('accordion'),
  panels: z.array(AccordionTabsPanel).min(1),
});

export const Flashcard = z.object({
  id: Id,
  front: RichText,
  back: RichText,
});
export const FlashcardPayload = z.object({
  cards: z.array(Flashcard).min(1),
});

export const TimelineEvent = z.object({
  id: Id,
  date: z.string(),
  title: z.string(),
  content: RichText,
  media: MediaRef.optional(),
});
export const TimelinePayload = z.object({
  events: z.array(TimelineEvent).min(1),
});

/** Base per i tipi valutabili: punteggio e feedback (Requisito 6.4). */
export const Scorable = z.object({
  points: z.number().nonnegative().default(1),
  feedbackCorrect: z.string().optional(),
  feedbackIncorrect: z.string().optional(),
});

export const DragDropMatchPair = z.object({
  id: Id,
  left: z.string(),
  right: z.string(),
});
export const DragDropMatchPayload = Scorable.extend({
  prompt: z.string(),
  pairs: z.array(DragDropMatchPair).min(2),
});

export const DragDropOrderItem = z.object({
  id: Id,
  label: z.string(),
  /** Posizione corretta (1-based). */
  correctPosition: z.number().int().positive(),
});
export const DragDropOrderPayload = Scorable.extend({
  prompt: z.string(),
  items: z.array(DragDropOrderItem).min(2),
});

export const ClickRevealItem = z.object({
  id: Id,
  trigger: z.string(),
  content: RichText,
});
export const ClickRevealPayload = z.object({
  items: z.array(ClickRevealItem).min(1),
});

export const BranchingChoice = z.object({
  id: Id,
  label: z.string(),
  /** Nodo di destinazione; assente se è un esito terminale. */
  nextNodeId: Id.optional(),
  /** Punteggio attribuito alla scelta (per scenari valutati). */
  score: z.number().optional(),
  feedback: z.string().optional(),
});
export const BranchingNode = z.object({
  id: Id,
  content: RichText,
  media: MediaRef.optional(),
  choices: z.array(BranchingChoice).default([]),
});
export const BranchingScenarioPayload = Scorable.partial().extend({
  startNodeId: Id,
  nodes: z.array(BranchingNode).min(1),
  /** Se true, lo scenario contribuisce al punteggio (Requisito 6.2). */
  scored: z.boolean().default(false),
});

export const VideoCheckpoint = z.object({
  id: Id,
  /** Secondo del video in cui compare il checkpoint. */
  atSeconds: z.number().nonnegative(),
  question: z.string(),
  /** Riferimento a una domanda definita nell'assessment, se valutato. */
  questionId: Id.optional(),
});

/**
 * Riga di trascrizione sincronizzata (karaoke): un segmento di parlato con il
 * suo intervallo temporale. `start`/`end` sono secondi del video. Il player
 * evidenzia la cue attiva al passare del tempo e permette il click-to-seek.
 * Popolata automaticamente dall'ASR (AWS Transcribe) sui video caricati.
 */
export const TranscriptCue = z.object({
  id: Id,
  /** Secondo di inizio del segmento. */
  start: z.number().nonnegative(),
  /** Secondo di fine del segmento (opzionale: si usa lo start della cue dopo). */
  end: z.number().nonnegative().optional(),
  /** Chi parla, se noto (diarizzazione). Opzionale. */
  speaker: z.string().optional(),
  text: z.string(),
});
export type TranscriptCue = z.infer<typeof TranscriptCue>;

/**
 * Sezione a tab del player video-first (stile Brain Bites): oltre alla
 * trascrizione, l'autore può affiancare tab di contenuto (es. "Punti chiave",
 * "Approfondimenti", "Risorse"). Ogni sezione è rich text.
 */
export const VideoSection = z.object({
  id: Id,
  title: z.string(),
  content: RichText,
});

/** Stato di avanzamento della trascrizione automatica (ASR). */
export const TranscriptStatus = z.enum(['none', 'processing', 'ready', 'failed']);
export type TranscriptStatus = z.infer<typeof TranscriptStatus>;

export const VideoCheckpointPayload = z.object({
  video: MediaRef,
  checkpoints: z.array(VideoCheckpoint).default([]),
  /** Trascrizione sincronizzata (karaoke). Generata via ASR o inserita a mano. */
  transcript: z.array(TranscriptCue).default([]),
  /** Stato della trascrizione automatica. */
  transcriptStatus: TranscriptStatus.default('none'),
  /** Motivo leggibile del fallimento ASR (presente solo con status 'failed'). */
  transcriptError: z.string().optional(),
  /** Riferimento al job ASR in corso (per ripristino dopo riavvio del server). */
  transcriptJobRef: z.string().optional(),
  /** Sezioni a tab affiancate al video (approfondimenti, punti chiave…). */
  sections: z.array(VideoSection).default([]),
});

export const CarouselStep = z.object({
  id: Id,
  title: z.string(),
  content: RichText,
  media: MediaRef.optional(),
});
export const CarouselStepsPayload = z.object({
  steps: z.array(CarouselStep).min(1),
});

/**
 * Sorting categories (Blocco I): l'utente trascina ogni elemento nella categoria
 * corretta. Interazione didattica premium per classificazioni (es. "DPI vs non
 * DPI", "rischio alto/medio/basso"). Valutabile.
 */
export const SortingCategory = z.object({
  id: Id,
  label: z.string(),
});
export const SortingItem = z.object({
  id: Id,
  label: z.string(),
  /** Id della categoria corretta. */
  categoryId: Id,
});
export const SortingCategoriesPayload = Scorable.extend({
  prompt: z.string(),
  categories: z.array(SortingCategory).min(2),
  items: z.array(SortingItem).min(2),
});

// --- Block discriminato -----------------------------------------------------

const base = { id: Id, editorial: EditorialMeta.default({}) };

export const Block = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('rich_text'), payload: RichTextPayload }),
  z.object({ ...base, type: z.literal('image_hotspot'), payload: ImageHotspotPayload }),
  z.object({ ...base, type: z.literal('accordion_tabs'), payload: AccordionTabsPayload }),
  z.object({ ...base, type: z.literal('flashcard'), payload: FlashcardPayload }),
  z.object({ ...base, type: z.literal('timeline'), payload: TimelinePayload }),
  z.object({ ...base, type: z.literal('dragdrop_match'), payload: DragDropMatchPayload }),
  z.object({ ...base, type: z.literal('dragdrop_order'), payload: DragDropOrderPayload }),
  z.object({ ...base, type: z.literal('click_reveal'), payload: ClickRevealPayload }),
  z.object({ ...base, type: z.literal('branching_scenario'), payload: BranchingScenarioPayload }),
  z.object({ ...base, type: z.literal('video_checkpoint'), payload: VideoCheckpointPayload }),
  z.object({ ...base, type: z.literal('carousel_steps'), payload: CarouselStepsPayload }),
  z.object({ ...base, type: z.literal('sorting_categories'), payload: SortingCategoriesPayload }),
]);
export type Block = z.infer<typeof Block>;
