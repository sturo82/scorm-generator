import React from 'react';
import { AbsoluteFill, Audio, Sequence } from 'remotion';
import {
  computeAllSceneBounds,
  resolveFrame,
  type SceneBounds,
  type VideoSpec,
  type WordMark,
} from '@scorm/contracts';
import { REGISTRY } from './registry.js';
import { AnimatedLayer } from './AnimatedLayer.js';
import { IllustratedBackground } from './components/IllustratedBackground.js';
import { Caption } from './components/Caption.js';

/**
 * Composition root del cartoon pillola: interpreta un VideoSpec + audio del
 * voiceover + word-timings. Ogni scena è una Sequence; i frame di scena e dei
 * layer si derivano da `video-spec-timing` (contracts) sui WordMark reali.
 */
export const PillolaVideo: React.FC<{
  spec: VideoSpec;
  /** URL/percorso dell'MP3 del voiceover (staticFile o URL assoluto). */
  audioSrc?: string;
  words: WordMark[];
}> = ({ spec, audioSrc, words }) => {
  const fps = spec.canvas.fps;
  const bounds = computeAllSceneBounds(spec.scenes, words, fps);

  return (
    <AbsoluteFill style={{ backgroundColor: spec.theme.bg, fontFamily: spec.theme.fontFamily }}>
      {audioSrc && <Audio src={audioSrc} />}
      {spec.scenes.map((scene, si) => {
        const b = bounds[si]!;
        return (
          <Sequence key={scene.id} from={b.startFrame} durationInFrames={b.length}>
            <SceneView scene={scene} bounds={b} words={words} fps={fps} palette={spec.theme.palette} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const SceneView: React.FC<{
  scene: VideoSpec['scenes'][number];
  bounds: SceneBounds;
  words: WordMark[];
  fps: number;
  palette: string[];
}> = ({ scene, bounds, words, fps, palette }) => {
  const bg = scene.background?.color;
  // Colore "primario" del tema come currentColor dei componenti SVG/testo.
  const primary = palette[0] ?? '#111827';
  const illustration = scene.illustration;
  const hasIllustration = !!illustration?.src;
  return (
    <AbsoluteFill style={{ backgroundColor: bg ?? (hasIllustration ? '#000' : undefined), color: primary }}>
      {/* Stile B (explainer illustrato): sfondo immagine cartoon animata (Ken
          Burns). Sopra, i layer (testo/diagrammi) e SEMPRE i sottotitoli
          karaoke sincronizzati con la voce. */}
      {hasIllustration && (
        <IllustratedBackground src={illustration!.src!} kenBurns={illustration!.kenBurns} />
      )}
      {scene.layers.map((layer) => {
        const Comp = REGISTRY[layer.component];
        if (!Comp) return null;
        // Frame relativi alla scena (la Sequence trasla già di startFrame).
        const inFrame = resolveFrame(layer.enter.at, bounds, words, fps) - bounds.startFrame;
        const outFrame = layer.exit
          ? resolveFrame(layer.exit.at, bounds, words, fps) - bounds.startFrame
          : bounds.length;
        return (
          <AnimatedLayer
            key={layer.id}
            inFrame={inFrame}
            outFrame={outFrame}
            enterAnim={layer.enter.anim}
            enterMs={layer.enter.ms}
            exitAnim={layer.exit?.anim}
            exitMs={layer.exit?.ms}
          >
            <Comp
              {...layer.props}
              words={words}
              fps={fps}
              sceneStartFrame={bounds.startFrame}
              wordStart={scene.wordRange?.start}
              wordEnd={scene.wordRange?.end}
            />
          </AnimatedLayer>
        );
      })}
      {/* Scena illustrata senza un layer Caption esplicito: aggiungiamo noi i
          sottotitoli karaoke, così la voce è sempre accompagnata dal testo. Il
          frame assoluto (sceneStartFrame) e la finestra di parole della scena
          servono a sincronizzare il karaoke col voiceover GLOBALE. */}
      {hasIllustration && !scene.layers.some((l) => l.component === 'Caption') && (
        <Caption
          words={words}
          fps={fps}
          sceneStartFrame={bounds.startFrame}
          wordStart={scene.wordRange?.start}
          wordEnd={scene.wordRange?.end}
        />
      )}
    </AbsoluteFill>
  );
};
