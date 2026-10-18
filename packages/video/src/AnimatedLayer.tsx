import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { AnimKind } from '@scorm/contracts';

/**
 * Avvolge un layer applicando animazioni generiche di ENTRATA e USCITA attorno
 * ai frame [inFrame, outFrame] (relativi alla scena). Le animazioni sono
 * interpolazioni morbide (opacity + transform), non rendering per-frame.
 * Fuori dall'intervallo il layer non è montato.
 */
export const AnimatedLayer: React.FC<{
  inFrame: number;
  outFrame: number;
  enterAnim: AnimKind;
  enterMs: number;
  exitAnim?: AnimKind;
  exitMs?: number;
  children: React.ReactNode;
}> = ({ inFrame, outFrame, enterAnim, enterMs, exitAnim, exitMs, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < inFrame || frame > outFrame) return null;

  const enterFrames = Math.max(1, Math.round((enterMs / 1000) * fps));
  const exitFrames = Math.max(1, Math.round(((exitMs ?? 300) / 1000) * fps));

  const enter = computeAnim(enterAnim, frame - inFrame, enterFrames, 'in');
  // L'uscita si calcola negli ultimi `exitFrames` frame prima di outFrame.
  const exitStart = outFrame - exitFrames;
  const exit =
    exitAnim && exitAnim !== 'none' && frame >= exitStart
      ? computeAnim(exitAnim, frame - exitStart, exitFrames, 'out')
      : { opacity: 1, translateX: 0, translateY: 0, scale: 1 };

  const opacity = Math.min(enter.opacity, exit.opacity);
  const translateX = enter.translateX + exit.translateX;
  const translateY = enter.translateY + exit.translateY;
  const scale = enter.scale * exit.scale;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        opacity,
        transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
      }}
    >
      {children}
    </div>
  );
};

interface AnimValues {
  opacity: number;
  translateX: number;
  translateY: number;
  scale: number;
}

/**
 * Calcola i valori di animazione per un progresso locale `local` su `duration`
 * frame. `dir` = 'in' (entrata: da invisibile a pieno) o 'out' (uscita: da pieno
 * a invisibile). Interpolazione lineare clampata.
 */
function computeAnim(kind: AnimKind, local: number, duration: number, dir: 'in' | 'out'): AnimValues {
  const base: AnimValues = { opacity: 1, translateX: 0, translateY: 0, scale: 1 };
  if (kind === 'none') return base;
  // p: 0→1 nel verso dell'animazione.
  const raw = interpolate(local, [0, duration], dir === 'in' ? [0, 1] : [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  switch (kind) {
    case 'fadeUp':
      return { ...base, opacity: raw, translateY: (1 - raw) * 24 };
    case 'fadeOut':
      return { ...base, opacity: raw };
    case 'slideIn':
      return { ...base, opacity: raw, translateX: (1 - raw) * -40 };
    case 'popIn':
      return { ...base, opacity: raw, scale: 0.8 + raw * 0.2 };
    default:
      return base;
  }
}
