import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

/**
 * Scheda di SEZIONE enterprise mostrata all'inizio di una scena (nel "respiro"
 * tra un micro-argomento e l'altro). Comunica in modo inequivocabile "nuovo
 * micro-argomento": numero di sezione progressivo (es. 02 / 07), un kicker
 * ("SEZIONE") e il titolo grande, su sfondo brand sobrio con linea d'accento e
 * una sottile griglia. Composizione corporate (allineata a sinistra, non
 * giocosa). Compare per i primi `holdFrames` frame della scena con fade in/out,
 * poi lascia spazio all'illustrazione. È temporizzata dal parent (PillolaVideo),
 * allineata al silenzio del voiceover (break SSML inter-scena).
 */
export const SceneTitleCard: React.FC<{
  title: string;
  holdFrames: number;
  bg: string;
  accent: string;
  /** Indice 1-based della sezione e totale, per il numero "NN / MM". */
  index?: number;
  total?: number;
  /** Etichetta kicker (default "SEZIONE"). */
  kicker?: string;
}> = ({ title, holdFrames, bg, accent, index, total, kicker = 'SEZIONE' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame >= holdFrames) return null;

  const appear = spring({ frame, fps, config: { damping: 200 } });
  const fadeStart = Math.max(1, Math.floor(holdFrames * 0.7));
  const fadeOut = interpolate(frame, [fadeStart, holdFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = Math.min(appear, fadeOut);
  // Micro-movimento d'ingresso: la linea d'accento si allunga, il testo sale.
  const barW = interpolate(appear, [0, 1], [0, 140]);
  const titleY = (1 - appear) * 28;
  const num =
    typeof index === 'number'
      ? `${String(index).padStart(2, '0')}${typeof total === 'number' ? ` / ${String(total).padStart(2, '0')}` : ''}`
      : '';

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: bg,
        opacity,
        zIndex: 5,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '0 10%',
      }}
    >
      {/* Griglia sottile di sfondo (texture corporate discreta). */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at 30% 50%, rgba(0,0,0,0.9), transparent 75%)',
        }}
      />
      {/* Grande numero di sezione in filigrana a destra: senso di "capitolo". */}
      {num && (
        <span
          style={{
            position: 'absolute',
            right: '6%',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 300,
            fontWeight: 800,
            color: 'rgba(255,255,255,0.06)',
            lineHeight: 1,
            userSelect: 'none',
          }}
        >
          {String(index).padStart(2, '0')}
        </span>
      )}

      {/* Blocco testo allineato a sinistra. */}
      <div style={{ position: 'relative', transform: `translateY(${titleY}px)`, maxWidth: '70%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <span style={{ width: barW, height: 6, borderRadius: 999, background: accent }} />
          <span
            style={{
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: accent,
            }}
          >
            {kicker}
            {num ? `  ·  ${num}` : ''}
          </span>
        </div>
        <span
          style={{
            display: 'block',
            fontSize: 92,
            fontWeight: 800,
            color: '#fff',
            lineHeight: 1.05,
            letterSpacing: '-0.01em',
            textShadow: '0 2px 18px rgba(0,0,0,0.35)',
          }}
        >
          {title}
        </span>
      </div>
    </div>
  );
};
