import React from 'react';
import { Composition } from 'remotion';
import { computeAllSceneBounds, type VideoSpec, type WordMark } from '@scorm/contracts';
import {
  SlideVideoSpec,
  computeSlideTimeline,
  type SlideVideoSpec as SlideVideoSpecT,
} from '@scorm/contracts';
import { PillolaVideo } from './PillolaVideo.js';
import { SlideAvatarVideo } from './SlideAvatarVideo.js';

export const SLIDE_COMPOSITION_ID = 'SlideAvatarVideo';

/** Id della composizione, usato dal renderer in fase di selezione. */
export const COMPOSITION_ID = 'PillolaVideo';

interface PillolaProps {
  spec: VideoSpec;
  audioSrc?: string;
  words: WordMark[];
}

/**
 * Durata totale (in frame) = fine dell'ultima scena. Calcolata dai WordMark e
 * dallo spec, così la timeline coincide con l'audio. Default prudenti quando
 * lo spec non è ancora disponibile (es. anteprima studio senza inputProps).
 */
function totalDuration(spec: VideoSpec | undefined, words: WordMark[]): { fps: number; durationInFrames: number } {
  if (!spec || !spec.scenes?.length) return { fps: 30, durationInFrames: 30 };
  const fps = spec.canvas.fps;
  const bounds = computeAllSceneBounds(spec.scenes, words ?? [], fps);
  const end = bounds.length ? bounds[bounds.length - 1]!.endFrame : fps;
  return { fps, durationInFrames: Math.max(1, end) };
}

/**
 * Root Remotion: registra la composizione PillolaVideo con durata/fps/dimensioni
 * DERIVATE dagli inputProps (lo spec). Il provider passa spec+audio+words come
 * inputProps al render.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
    <Composition
      id={SLIDE_COMPOSITION_ID}
      component={SlideAvatarVideo as React.FC<Record<string, unknown>>}
      durationInFrames={30}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ spec: undefined as unknown as SlideVideoSpecT }}
      calculateMetadata={({ props }) => {
        const raw = (props as unknown as { spec?: unknown }).spec;
        if (!raw) return { durationInFrames: 30, fps: 30, width: 1920, height: 1080 };
        const spec = SlideVideoSpec.parse(raw);
        const t = computeSlideTimeline(spec.slides, spec.canvas.fps);
        return {
          durationInFrames: Math.max(1, t.totalFrames),
          fps: spec.canvas.fps,
          width: spec.canvas.width,
          height: spec.canvas.height,
        };
      }}
    />
    <Composition
      id={COMPOSITION_ID}
      component={PillolaVideo as React.FC<Record<string, unknown>>}
      // Placeholder: sovrascritti da calculateMetadata sugli inputProps reali.
      durationInFrames={30}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ spec: undefined as unknown as VideoSpec, words: [] as WordMark[] }}
      calculateMetadata={({ props }) => {
        const p = props as unknown as PillolaProps;
        const { fps, durationInFrames } = totalDuration(p.spec, p.words ?? []);
        const width = p.spec?.canvas.width ?? 1920;
        const height = p.spec?.canvas.height ?? 1080;
        return { durationInFrames, fps, width, height };
      }}
    />
    </>
  );
};
