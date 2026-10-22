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
import { SceneTitleCard } from './components/SceneTitleCard.js';

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
  // Numero di scene con titolo: per numerare le schede di sezione (NN / MM).
  const titledTotal = spec.scenes.filter((s) => s.title && s.wordRange).length;

  return (
    <AbsoluteFill style={{ backgroundColor: spec.theme.bg, fontFamily: spec.theme.fontFamily }}>
      {audioSrc && <Audio src={audioSrc} />}
      {spec.scenes.map((scene, si) => {
        const b = bounds[si]!;
        // Scheda di sezione: la mostriamo nel "respiro" iniziale della scena
        // (gap tra la fine del parlato della scena precedente e la prima parola
        // di questa). Frame di hold = durata del gap, con minimo e massimo.
        const holdFrames = titleHoldFrames(spec, scene, words, fps, si);
        // Indice 1-based della scena TITOLATA (salta eventuali scene senza titolo).
        const titledIndex =
          spec.scenes.slice(0, si + 1).filter((s) => s.title && s.wordRange).length;
        return (
          <Sequence key={scene.id} from={b.startFrame} durationInFrames={b.length}>
            <SceneView
              scene={scene}
              bounds={b}
              words={words}
              fps={fps}
              palette={spec.theme.palette}
              titleHold={holdFrames}
              titleIndex={titledIndex}
              titleTotal={titledTotal}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

/**
 * Durata (in frame) della scheda di sezione all'inizio di una scena: pari al
 * "respiro" prima della prima parola della scena (gap dal parlato precedente),
 * con un minimo leggibile e un massimo prudente. 0 se la scena non ha titolo o
 * non ha una finestra di parole (niente scheda).
 */
function titleHoldFrames(
  spec: VideoSpec,
  scene: VideoSpec['scenes'][number],
  words: WordMark[],
  fps: number,
  sceneIdx: number,
): number {
  if (!scene.title || !scene.wordRange || words.length === 0) return 0;
  const firstIdx = Math.min(scene.wordRange.start, words.length - 1);
  const firstWordMs = words[firstIdx]!.startMs;
  // Fine del parlato precedente: endMs della parola prima dell'inizio scena.
  const prevEndMs = firstIdx > 0 ? words[firstIdx - 1]!.endMs : 0;
  const gapMs = Math.max(0, firstWordMs - prevEndMs);
  // La scheda di sezione deve restare abbastanza a lungo da essere LETTA. Il gap
  // audio ai confini di scena è ~2.5s (break SSML), ma garantiamo comunque una
  // finestra leggibile. La prima scena non ha parlato precedente: intro piena.
  const effectiveMs = sceneIdx === 0 ? Math.max(gapMs, 2500) : gapMs;
  const MIN_MS = 2000;
  const MAX_MS = 3500;
  const clamped = Math.max(MIN_MS, Math.min(MAX_MS, effectiveMs));
  return Math.round((clamped / 1000) * fps);
}

const SceneView: React.FC<{
  scene: VideoSpec['scenes'][number];
  bounds: SceneBounds;
  words: WordMark[];
  fps: number;
  palette: string[];
  titleHold?: number;
  titleIndex?: number;
  titleTotal?: number;
}> = ({ scene, bounds, words, fps, palette, titleHold = 0, titleIndex, titleTotal }) => {
  const bg = scene.background?.color;
  // Colore "primario" del tema come currentColor dei componenti SVG/testo.
  const primary = palette[0] ?? '#111827';
  const accent = palette[1] ?? palette[0] ?? '#2563eb';
  const cardBg = palette[0] ?? '#0f172a';
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
      {/* Scheda di SEZIONE enterprise: compare nel respiro iniziale della scena
          (sopra tutto), per segnare il passaggio a un nuovo micro-argomento. */}
      {scene.title && titleHold > 0 && (
        <SceneTitleCard
          title={scene.title}
          holdFrames={titleHold}
          bg={cardBg}
          accent={accent}
          index={titleIndex}
          total={titleTotal}
        />
      )}
    </AbsoluteFill>
  );
};
