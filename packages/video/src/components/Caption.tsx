import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { ComponentProps } from '../types.js';

/**
 * Sottotitolo "karaoke": mostra il voiceover ed evidenzia la parola in corso
 * al tempo corrente, usando i WordMark (startMs/endMs). Se non ci sono words,
 * mostra il testo passato come prop `text`.
 */
export const Caption: React.FC<ComponentProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = Array.isArray(props.words) ? props.words : [];
  const nowMs = (frame / fps) * 1000;

  if (words.length === 0) {
    const text = String(props.text ?? '');
    return <CaptionBox>{text}</CaptionBox>;
  }

  // Indice della parola attiva: l'ultima il cui startMs <= nowMs < endMs.
  let activeIdx = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i]!.startMs <= nowMs && nowMs < words[i]!.endMs) {
      activeIdx = i;
      break;
    }
    if (words[i]!.startMs <= nowMs) activeIdx = i;
  }

  return (
    <CaptionBox>
      {words.map((w, i) => (
        <span
          key={i}
          style={{
            opacity: i === activeIdx ? 1 : 0.55,
            fontWeight: i === activeIdx ? 800 : 500,
            marginRight: 10,
            transition: 'opacity 80ms linear',
          }}
        >
          {w.word}
        </span>
      ))}
    </CaptionBox>
  );
};

const CaptionBox: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      position: 'absolute',
      bottom: 64,
      left: '8%',
      right: '8%',
      textAlign: 'center',
      fontSize: 40,
      lineHeight: 1.3,
      padding: '16px 24px',
      borderRadius: 16,
      background: 'rgba(17,24,39,0.72)',
      color: '#fff',
    }}
  >
    {children}
  </div>
);
