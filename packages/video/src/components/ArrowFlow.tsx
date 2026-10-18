import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ComponentProps } from '../types.js';

/**
 * Flusso orizzontale di nodi collegati da frecce (SVG): input→processo→output.
 * I nodi+frecce compaiono in sequenza. Props: steps (string[], 2-5).
 */
export const ArrowFlow: React.FC<ComponentProps> = (props) => {
  const steps = (Array.isArray(props.steps) ? (props.steps as unknown[]).map(String) : []).slice(0, 5);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const n = Math.max(steps.length, 1);

  const nodeW = 300;
  const nodeH = 140;
  const gap = 70;
  const totalW = n * nodeW + (n - 1) * gap;
  const startX = (1920 - totalW) / 2;
  const y = (1080 - nodeH) / 2;
  const appearEvery = Math.max(1, Math.round(0.45 * fps));

  return (
    <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ overflow: 'visible' }}>
      <defs>
        <marker id="af-arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 Z" fill="currentColor" />
        </marker>
      </defs>
      {steps.map((step, i) => {
        const x = startX + i * (nodeW + gap);
        const opacity = interpolate(frame, [i * appearEvery, i * appearEvery + appearEvery], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        return (
          <g key={i} opacity={opacity}>
            {i > 0 && (
              <line
                x1={x - gap + 6}
                y1={y + nodeH / 2}
                x2={x - 10}
                y2={y + nodeH / 2}
                stroke="currentColor"
                strokeWidth={6}
                markerEnd="url(#af-arrow)"
              />
            )}
            <rect x={x} y={y} width={nodeW} height={nodeH} rx={16} fill="none" stroke="currentColor" strokeWidth={6} />
            <text
              x={x + nodeW / 2}
              y={y + nodeH / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={34}
              fontWeight={700}
              fill="currentColor"
            >
              {step}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
