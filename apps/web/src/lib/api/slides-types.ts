/** Tipi lato web del flusso "video-lezione da slide" (specchio delle viste dell'API). */

export interface SlideImportSlide {
  index: number;
  imageKey: string;
  imageUrl: string;
  text: string;
  /** Solo negli import da video: il video al posto della slide (imageUrl è il fotogramma di copertina). */
  video?: SlideImportVideo;
}
export interface SlideImportVideo {
  filename: string;
  contentType: string;
  fileDurationSec: number;
  trim?: { start: number; end: number };
  mode: 'manual' | 'hint' | 'frames';
  hint?: string;
  script?: string;
  url: string;
  /** Durata effettiva (tratto scelto o video intero). */
  durationSec: number;
  frames: number;
  /** File sorgente: più spezzoni dello stesso video hanno lo stesso `sourceId`. */
  sourceId: string;
  /** Il copione parte anche dal parlato del video (trascrizione). */
  transcribe?: boolean;
}
export interface SlideImportView {
  importId: string;
  courseId: string;
  filename: string;
  createdAt: string;
  /** Lingua dei copioni (solo import di libreria). */
  language?: string;
  kind?: 'slides' | 'videos';
  slides: SlideImportSlide[];
}
/** Come combaciano video e voce di un elemento, a clip generate. */
export interface VideoTiming {
  index: number;
  videoSec: number;
  voiceSec: number;
  mode: 'match' | 'speed' | 'freeze' | 'cut';
  rate: number;
}

export interface SlideExtraTopic {
  title: string;
  summary: string;
  bullets: string[];
}
export interface SlideScriptEntry {
  index: number;
  script: string;
  skip: boolean;
  words: number;
  estSec: number;
  /** Import da video: durata del video da coprire (s) e fonte del copione. */
  targetSec?: number;
  source?: 'manual' | 'hint' | 'frames';
  /** Il copione integra contenuti della knowledge assenti dalla slide. */
  usedKnowledge?: boolean;
  /** Contraddizioni slide/knowledge (nel copione prevale la slide). */
  conflicts?: string[];
  /** Presente per le slide "extra": argomenti della knowledge non coperti dalle slide. */
  extra?: SlideExtraTopic;
}
export interface SlideScriptsDoc {
  importId: string;
  courseId: string;
  language: string;
  status: 'draft' | 'approved';
  model: string;
  knowledgeDocIds?: string[];
  knowledgeNames?: string[];
  updatedAt: string;
  slides: SlideScriptEntry[];
  totalWords: number;
  estTotalSec: number;
  /** Pronuncia di nomi e sigle (solo audio). */
  glossary?: PronunciationEntry[];
  /** Import da video: ritmo di parlato per la taratura (parole/s), misurato sulle clip se ci sono. */
  wordsPerSec?: number;
}

export interface PronunciationEntry {
  term: string;
  spoken: string;
}

/** Copertina o schermata finale: sfondo = una slide o un fotogramma della clip di una slide. */
export interface SlideCardChoice {
  title?: string;
  subtitle?: string;
  background?: { kind: 'slide'; index: number } | { kind: 'frame'; index: number; atSec: number };
}

export type SlideAvatarType = 'photo' | 'studio' | 'digital_twin';
export type SlideEngine = 'avatar_iii' | 'avatar_iv' | 'avatar_v';

/** Modifiche in attesa sul video da slide: clip da rifare e rimontaggio, con il costo complessivo. */
export interface SlideChangesView {
  billed: boolean;
  clips: { slides: number; minutes: number; credits: number | null; indexes: number[] };
  render: { minutes: number; credits: number | null };
  removed: number;
  outdated: boolean;
  pending: boolean;
  running: 'clips' | 'lesson' | null;
  total: number | null;
}
export interface SlideClipsEstimate {
  slides: number;
  minutes: number;
  costUsd: number;
  engine: string;
  avatarType: SlideAvatarType;
  maxMinutes: number;
}
export interface SlideClip {
  index: number;
  state: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  error?: string;
  durationSec?: number;
  clipUrl?: string;
}
export interface SlideClipsView {
  importId: string;
  status: 'running' | 'completed' | 'failed';
  avatarId: string;
  avatarType: SlideAvatarType;
  voiceId?: string;
  engine: string;
  /** Ultimo salvataggio: dopo una rigenerazione indica quando le clip sono state aggiornate. */
  updatedAt?: string;
  clips: SlideClip[];
  progress: { total: number; completed: number; failed: number; processing: number };
  totalDurationSec: number;
}
export interface StartSlideClipsInput {
  avatarId: string;
  avatarType: SlideAvatarType;
  voiceId?: string;
  engine?: SlideEngine;
}

export interface SlideSection {
  title: string;
  /** Prima slide della sezione (1-based). */
  from: number;
}

export type PipPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
/** Inquadratura di una slide nel layout dinamico. */
export type SlideShot = 'presenter' | 'side' | 'focus' | 'mini';
export type SlideLayout = 'split' | 'pip' | 'dynamic';
export interface SlideDirectionItem {
  index: number;
  shot: SlideShot;
  corner: PipPosition;
  words: number;
}

export interface SlideLessonView {
  importId: string;
  status: 'running' | 'completed' | 'failed';
  step: 'render' | 'summary' | 'lesson' | 'quiz' | 'final_quiz' | 'done';
  error?: string;
  layout: SlideLayout;
  pipPosition?: PipPosition;
  slidePositions?: Record<string, PipPosition>;
  slideShots?: Record<string, SlideShot>;
  avatarFrame?: { x?: number; y?: number; zoom?: number };
  avatarLook?: Partial<import('@scorm/contracts').AvatarLook>;
  slideLooks?: Record<string, Partial<import('@scorm/contracts').AvatarLook>>;
  slideFrames?: Record<string, { x?: number; y?: number; zoom?: number }>;
  burnCaptions?: boolean;
  cover?: SlideCardChoice;
  outro?: SlideCardChoice;
  brandId?: string;
  moduleTitle: string;
  mode: 'single' | 'sections';
  /** True durante il rimontaggio dei video con le slide aggiornate. */
  remaster?: boolean;
  updatedAt?: string;
  currentPart: number;
  parts: Array<{ id: string; title: string; done: boolean; moduleId?: string; lessonId?: string; videoAssetId?: string }>;
  moduleId?: string;
  lessonId?: string;
}

/** Stato della generazione dei copioni, che gira in background sul server. */
export interface SlideScriptsGeneration {
  status: 'running' | 'failed' | 'completed';
  error?: string;
  startedAt?: string;
}
export type SlideScriptsResponse = (SlideScriptsDoc | { status: 'none' }) & { generation?: SlideScriptsGeneration };
