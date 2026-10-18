import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ComponentProps } from '../types.js';

/**
 * Testo (titolo o corpo) con comparsa morbida (spring su opacità + salita).
 * Vettoriale/DOM, nessun raster. Props: text, variant ('title'|'body').
 */
export const TextReveal: React.FC<ComponentProps> = (props) => {
  const text = String(props.text ?? '');
  const variant = props.variant === 'title' ? 'title' : 'body';
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 200 } });
  const y = (1 - p) * 24;
  return (
    <div
      style={{
        transform: `translateY(${y}px)`,
        opacity: p,
        fontSize: variant === 'title' ? 96 : 48,
        fontWeight: 700,
        textAlign: 'center',
        lineHeight: 1.15,
        maxWidth: '80%',
        color: typeof props.color === 'string' ? props.color : 'inherit',
      }}
    >
      {text}
    </div>
  );
};
