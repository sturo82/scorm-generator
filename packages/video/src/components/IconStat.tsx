import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ComponentProps } from '../types.js';

/**
 * Statistica con numero che conta da 0 al valore target + etichetta. Props:
 * value (number), label? (string), suffix? (string, es. "%"), durationMs?
 * (default 1200), icon? (string emoji/glyph opzionale).
 */
export const IconStat: React.FC<ComponentProps> = (props) => {
  const value = typeof props.value === 'number' ? props.value : Number(props.value) || 0;
  const label = typeof props.label === 'string' ? props.label : '';
  const suffix = typeof props.suffix === 'string' ? props.suffix : '';
  const icon = typeof props.icon === 'string' ? props.icon : '';
  const durationMs = typeof props.durationMs === 'number' ? props.durationMs : 1200;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur = Math.max(1, Math.round((durationMs / 1000) * fps));
  const current = interpolate(frame, [0, dur], [0, value], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const display = Number.isInteger(value) ? Math.round(current) : current.toFixed(1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      {icon && <div style={{ fontSize: 120, lineHeight: 1 }}>{icon}</div>}
      <div style={{ fontSize: 160, fontWeight: 900, lineHeight: 1 }}>
        {display}
        {suffix}
      </div>
      {label && <div style={{ fontSize: 48, opacity: 0.8 }}>{label}</div>}
    </div>
  );
};
