import type { VideoSpec, Scene, Layer, WordMark } from '@scorm/contracts';

/** Props comuni passate a ogni componente del registry. */
export interface ComponentProps {
  /** Props libere dal VideoSpec (validate a monte dallo schema). */
  [key: string]: unknown;
  /** Word-timings del voiceover (per i componenti sincronizzati, es. Caption). */
  words?: WordMark[];
  /** Frame rate della composizione. */
  fps?: number;
  /**
   * Frame ASSOLUTO di inizio della scena corrente: dentro una <Sequence> il
   * frame di Remotion è relativo alla Sequence (riparte da 0), ma i word-marks
   * sono sulla timeline GLOBALE. I componenti sincronizzati (Caption) sommano
   * questo offset per calcolare il tempo assoluto del voiceover.
   */
  sceneStartFrame?: number;
  /** Finestra di parole del voiceover coperta da questa scena [wordStart, wordEnd). */
  wordStart?: number;
  wordEnd?: number;
}

export type { VideoSpec, Scene, Layer, WordMark };
