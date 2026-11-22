import React from 'react';
import { Freeze, Img, OffthreadVideo, useCurrentFrame, useVideoConfig } from 'remotion';
import { videoTiming, type SlideVideoSlide } from '@scorm/contracts';

/**
 * Contenuto di una slide: l'immagine oppure, nel percorso "da video", il video muto (si sente solo
 * l'avatar). La durata della slide è quella della voce: se il video differisce di poco cambia
 * leggermente velocità per finire insieme; se è più corto si ferma sull'ultimo fotogramma, se è
 * più lungo si taglia con la fine della slide. `useCurrentFrame` è locale alla Sequence della slide.
 */
export const SlideMedia: React.FC<{ slide: SlideVideoSlide; style: React.CSSProperties }> = ({ slide, style }) => {
  const local = useCurrentFrame();
  const { fps } = useVideoConfig();
  const v = slide.video;
  if (!v) return slide.imageUrl ? <Img src={slide.imageUrl} style={style} /> : null;
  const timing = videoTiming(v.durationSec, slide.durationSec);
  const trimBefore = Math.round(v.startSec * fps);
  const sourceFrames = Math.max(1, Math.round(v.durationSec * fps));
  // Frame di uscita che coprono il tratto del video alla velocità scelta.
  const playFrames = Math.max(1, Math.floor(sourceFrames / timing.rate));
  const media = (
    <OffthreadVideo src={v.url} muted playbackRate={timing.rate} trimBefore={trimBefore} trimAfter={trimBefore + sourceFrames} style={style} />
  );
  if (local >= playFrames) return <Freeze frame={playFrames - 1}>{media}</Freeze>;
  return media;
};
