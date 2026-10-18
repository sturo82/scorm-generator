import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ComponentProps } from '../types.js';

/**
 * Pannello "lower-third" in stile explainer: una barra/testo che entra dal basso
 * con uno spring morbido. Usato per il titolo/concetto della scena sopra
 * l'illustrazione. Vettoriale/DOM, colori del tema.
 */
export const LowerThird: React.FC<ComponentProps> = (props) => {
  const text = String(props.text ?? '');
  const accent = typeof props.accent === 'string' ? props.accent : '#0ea5e9';
  const variant = props.variant === 'body' ? 'body' : 'title';
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 200 } });
  const y = (1 - p) * 40;
  return (
    <div
      style={{
        position: 'absolute',
        left: '6%',
        right: '6%',
        top: '10%',
        transform: `translateY(${y}px)`,
        opacity: p,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}
    >
      <span style={{ width: 10, alignSelf: 'stretch', borderRadius: 6, background: accent }} />
      <span
        style={{
          fontSize: variant === 'title' ? 72 : 44,
          fontWeight: 800,
          color: '#fff',
          textShadow: '0 2px 12px rgba(0,0,0,0.45)',
          lineHeight: 1.1,
        }}
      >
        {text}
      </span>
    </div>
  );
};
