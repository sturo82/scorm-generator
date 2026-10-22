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

  // Raggruppa le parole in FRASI (chunk a lunghezza limitata, tagliati sulla
  // punteggiatura). Il sottotitolo mostra UNA frase alla volta, FERMA: le
  // parole non scorrono. Cambia blocco solo quando si passa alla frase
  // successiva, e dentro la frase si sposta SOLO l'evidenziazione.
  const groups = groupWordsIntoLines(words);
  const activeGroup = groups.find((g) => activeIdx >= g.from && activeIdx < g.to) ?? groups[0]!;

  return (
    <CaptionBox>
      {words.slice(activeGroup.from, activeGroup.to).map((w, i) => {
        const globalIdx = activeGroup.from + i;
        const isActive = globalIdx === activeIdx;
        return (
          <span
            key={globalIdx}
            style={{
              opacity: isActive ? 1 : 0.6,
              fontWeight: isActive ? 800 : 500,
              color: isActive ? '#ffe27a' : '#fff',
              marginRight: 10,
              transition: 'opacity 80ms linear, color 80ms linear',
            }}
          >
            {w.word}
          </span>
        );
      })}
    </CaptionBox>
  );
};

/**
 * Raggruppa le parole in "righe di sottotitolo" STABILI: una riga finisce su
 * una parola con punteggiatura di chiusura (., !, ?, :, ;) oppure al più dopo
 * MAX_WORDS parole. Così ogni riga sta nel box senza scorrere e cambia solo al
 * passaggio alla riga successiva. Ritorna gli indici [from, to) di ogni gruppo.
 */
function groupWordsIntoLines(words: Array<{ word: string }>): Array<{ from: number; to: number }> {
  const MAX_WORDS = 9;
  const groups: Array<{ from: number; to: number }> = [];
  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const endsSentence = /[.!?:;]$/.test(words[i]!.word);
    const reachedMax = i - from + 1 >= MAX_WORDS;
    if (endsSentence || reachedMax || i === words.length - 1) {
      groups.push({ from, to: i + 1 });
      from = i + 1;
    }
  }
  if (groups.length === 0) groups.push({ from: 0, to: words.length });
  return groups;
}

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
