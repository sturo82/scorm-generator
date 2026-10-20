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
  if (activeIdx < 0) activeIdx = 0;

  // FINESTRA scorrevole: mostra solo alcune parole attorno a quella attiva,
  // così il sottotitolo resta SEMPRE dentro il box (poche righe) invece di
  // crescere con tutto il voiceover e sfondare il frame.
  const WINDOW_BEFORE = 5;
  const WINDOW_AFTER = 7;
  const from = Math.max(0, activeIdx - WINDOW_BEFORE);
  const to = Math.min(words.length, activeIdx + WINDOW_AFTER + 1);
  const windowWords = words.slice(from, to);

  return (
    <CaptionBox>
      {windowWords.map((w, i) => {
        const globalIdx = from + i;
        const isActive = globalIdx === activeIdx;
        return (
          <span
            key={globalIdx}
            style={{
              opacity: isActive ? 1 : 0.55,
              fontWeight: isActive ? 800 : 500,
              marginRight: 10,
              transition: 'opacity 80ms linear',
            }}
          >
            {w.word}
          </span>
        );
      })}
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
      // Vincolo di altezza: il box non supera ~3 righe e taglia l'eccesso, così
      // non esce mai dall'area del video (difesa anche se arrivano molte parole).
      maxHeight: '28%',
      overflow: 'hidden',
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: 'center',
      alignContent: 'flex-end',
      gap: '0 2px',
      textAlign: 'center',
      fontSize: 40,
      lineHeight: 1.3,
      padding: '16px 24px',
      borderRadius: 16,
      background: 'rgba(17,24,39,0.72)',
      color: '#fff',
      boxSizing: 'border-box',
    }}
  >
    {children}
  </div>
);
