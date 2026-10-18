import type { VideoSpec, Scene, Layer, WordMark } from '@scorm/contracts';

/** Props comuni passate a ogni componente del registry. */
export interface ComponentProps {
  /** Props libere dal VideoSpec (validate a monte dallo schema). */
  [key: string]: unknown;
  /** Word-timings del voiceover (per i componenti sincronizzati, es. Caption). */
  words?: WordMark[];
  /** Frame rate della composizione. */
  fps?: number;
}

export type { VideoSpec, Scene, Layer, WordMark };
