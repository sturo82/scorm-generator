/** Tipi lato web del flusso "video-lezione da slide" (specchio delle viste dell'API). */

export interface SlideImportSlide {
  index: number;
  imageKey: string;
  imageUrl: string;
  text: string;
}
export interface SlideImportView {
  importId: string;
  courseId: string;
  filename: string;
  createdAt: string;
  slides: SlideImportSlide[];
}

export interface SlideScriptEntry {
  index: number;
  script: string;
  skip: boolean;
  words: number;
  estSec: number;
}
export interface SlideScriptsDoc {
  importId: string;
  courseId: string;
  language: string;
  status: 'draft' | 'approved';
  model: string;
  updatedAt: string;
  slides: SlideScriptEntry[];
  totalWords: number;
  estTotalSec: number;
}

export type SlideAvatarType = 'photo' | 'studio' | 'digital_twin';
export type SlideEngine = 'avatar_iii' | 'avatar_iv' | 'avatar_v';

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
  engine: string;
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

export interface SlideLessonView {
  importId: string;
  status: 'running' | 'completed' | 'failed';
  step: 'render' | 'summary' | 'lesson' | 'quiz' | 'done';
  error?: string;
  layout: 'split' | 'pip';
  moduleTitle: string;
  moduleId?: string;
  lessonId?: string;
}
