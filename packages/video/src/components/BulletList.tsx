import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ComponentProps } from '../types.js';

/**
 * Elenco puntato i cui elementi compaiono UNO ALLA VOLTA a cadenza regolare.
 * Props: items (string[]), title? (string), staggerMs? (default 600).
 */
export const BulletList: React.FC<ComponentProps> = (props) => {
  const items = Array.isArray(props.items) ? (props.items as unknown[]).map((x) => String(x)) : [];
  const title = typeof props.title === 'string' ? props.title : undefined;
  const staggerMs = typeof props.staggerMs === 'number' ? props.staggerMs : 600;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stagger = Math.max(1, Math.round((staggerMs / 1000) * fps));

  return (
    <div style={{ width: '72%', maxWidth: 1100 }}>
      {title && <div style={{ fontSize: 56, fontWeight: 800, marginBottom: 28 }}>{title}</div>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((item, i) => {
          const appearAt = i * stagger;
          const opacity = interpolate(frame, [appearAt, appearAt + stagger / 2], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          const x = interpolate(frame, [appearAt, appearAt + stagger / 2], [-24, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return (
            <li
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                fontSize: 44,
                marginBottom: 20,
                opacity,
                transform: `translateX(${x}px)`,
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  background: 'currentColor',
                  flexShrink: 0,
                  opacity: 0.8,
                }}
              />
              <span>{item}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
