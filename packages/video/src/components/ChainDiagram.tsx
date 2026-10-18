import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ComponentProps } from '../types.js';

/**
 * Catena di blocchi collegati (SVG): utile per concetti tipo blockchain,
 * processi o step sequenziali. I blocchi compaiono in sequenza; `highlight`
 * evidenzia un blocco. Props: blocks (number, default 3), highlight? (number),
 * labels? (string[]).
 */
export const ChainDiagram: React.FC<ComponentProps> = (props) => {
  const count = clampInt(props.blocks, 3, 1, 6);
  const highlight = typeof props.highlight === 'number' ? props.highlight : -1;
  const labels = Array.isArray(props.labels) ? (props.labels as unknown[]).map(String) : [];
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const boxW = 240;
  const boxH = 160;
  const gap = 80;
  const totalW = count * boxW + (count - 1) * gap;
  const startX = (1920 - totalW) / 2;
  const y = (1080 - boxH) / 2;
  const appearEvery = Math.max(1, Math.round(0.4 * fps));

  return (
    <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ overflow: 'visible' }}>
      {Array.from({ length: count }).map((_, i) => {
        const x = startX + i * (boxW + gap);
        const opacity = interpolate(frame, [i * appearEvery, i * appearEvery + appearEvery], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        const isHi = i === highlight;
        return (
          <g key={i} opacity={opacity}>
            {i > 0 && (
              <line
                x1={x - gap}
                y1={y + boxH / 2}
                x2={x}
                y2={y + boxH / 2}
                stroke="currentColor"
                strokeWidth={6}
                opacity={0.5}
              />
            )}
            <rect
              x={x}
              y={y}
              width={boxW}
              height={boxH}
              rx={18}
              fill={isHi ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth={6}
              opacity={isHi ? 0.15 : 1}
            />
            <rect x={x} y={y} width={boxW} height={boxH} rx={18} fill="none" stroke="currentColor" strokeWidth={6} />
            <text
              x={x + boxW / 2}
              y={y + boxH / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={38}
              fontWeight={700}
              fill="currentColor"
            >
              {labels[i] ?? `#${i + 1}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

function clampInt(v: unknown, dflt: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.round(n)));
}
