import React from 'react';
import { Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

/**
 * Sfondo illustrato della scena (stile explainer "Brain Bites"): l'immagine
 * cartoon 2D riempie il frame e si anima con un lento movimento di camera
 * (Ken Burns) — pan/zoom — per dare vita all'illustrazione statica. Un velo
 * scuro in basso migliora la leggibilità di testo/sottotitoli sopra.
 */
export const IllustratedBackground: React.FC<{
  src: string;
  kenBurns?: 'in' | 'out' | 'left' | 'right' | 'none';
}> = ({ src, kenBurns = 'in' }) => {
  const [failed, setFailed] = React.useState(false);
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const p = interpolate(frame, [0, Math.max(1, durationInFrames)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Scala sempre >1 così c'è margine per il pan senza bordi vuoti.
  let scale = 1.12;
  let tx = 0;
  const ty = 0;
  switch (kenBurns) {
    case 'in':
      scale = interpolate(p, [0, 1], [1.05, 1.18]);
      break;
    case 'out':
      scale = interpolate(p, [0, 1], [1.18, 1.05]);
      break;
    case 'left':
      tx = interpolate(p, [0, 1], [3, -3]);
      break;
    case 'right':
      tx = interpolate(p, [0, 1], [-3, 3]);
      break;
    case 'none':
      scale = 1.0;
      break;
  }

  return (
    <>
      {!failed && (
        <Img
          src={src}
          // Se l'immagine non carica, NON bloccare il render (Remotion andrebbe
          // in timeout): la nascondiamo e resta lo sfondo/testo.
          onError={() => setFailed(true)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${scale}) translate(${tx}%, ${ty}%)`,
          }}
        />
      )}
      {/* Velo in basso per leggibilità di lower-third e sottotitoli. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%)',
        }}
      />
    </>
  );
};
