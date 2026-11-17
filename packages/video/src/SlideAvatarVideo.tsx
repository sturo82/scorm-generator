import React from 'react';
import { DynamicSlideVideo } from './DynamicSlideVideo.js';
import { AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import {
  SlideVideoSpec,
  activeCueAt,
  computeSlideTimeline,
  globalCues,
  type GlobalCue,
  type PipPosition,
  type SlideTimeline,
} from '@scorm/contracts';

/**
 * Composition "slide + avatar": ogni slide resta a schermo per la durata della
 * sua clip avatar, che la racconta. Due disposizioni:
 *  - split: slide a sinistra (~2/3), avatar ritagliato sul viso a destra,
 *    sottotitoli sotto la slide, pannello con contatore e avanzamento. Nessun
 *    elemento copre il contenuto della slide.
 *  - pip: slide a tutto schermo con l'avatar in un cerchio in basso a destra.
 *
 * I tempi derivano da `computeSlideTimeline` (@scorm/contracts), la stessa
 * funzione che l'API usa per la trascrizione: video e testo restano allineati.
 * I sottotitoli sono righe FERME, una cue alla volta (niente scorrimento).
 */
export const SlideAvatarVideo: React.FC<{ spec: SlideVideoSpec }> = ({ spec: rawSpec }) => {
  // Applica i default dello schema anche se l'API passa uno spec parziale.
  const spec = React.useMemo(() => SlideVideoSpec.parse(rawSpec), [rawSpec]);
  // Layout "dynamic": regia con inquadrature animate per slide.
  if (spec.layout === 'dynamic') return <DynamicSlideVideo spec={spec} />;
  return <StaticSlideVideo spec={spec} />;
};

/** Layout fissi "split" e "pip". */
const StaticSlideVideo: React.FC<{ spec: SlideVideoSpec }> = ({ spec }) => {
  const { fps } = useVideoConfig();
  const timeline = React.useMemo(() => computeSlideTimeline(spec.slides, fps), [spec.slides, fps]);
  const cues = React.useMemo(() => globalCues(spec.slides, timeline), [spec.slides, timeline]);
  const g = geometry(spec);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: spec.theme.bg,
        color: spec.theme.text,
        fontFamily: 'Inter, Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      {spec.slides.map((slide, i) => {
        const e = timeline.entries[i]!;
        return (
          <Sequence key={slide.id} from={e.startFrame} durationInFrames={e.durationFrames}>
            <SlideScene spec={spec} slideIndex={i} g={geometry(spec, slide.pipPosition)} />
          </Sequence>
        );
      })}
      {spec.burnCaptions && <Captions cues={cues} spec={spec} timeline={timeline} />}
      <SidePanel spec={spec} timeline={timeline} g={g} />
    </AbsoluteFill>
  );
};

/* ------------------------------ Geometria ---------------------------------- */

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
interface Geometry {
  s: number;
  slide: Box;
  avatar: Box;
  caption: Box;
  panel: Box;
  radius: number;
}

/**
 * Posizioni in px per il canvas dato (progettate su 1920x1080, scalate). Nel layout pip
 * `pos` sceglie l'angolo del cerchio avatar (default quello del video); il box dei
 * sottotitoli si sposta di conseguenza per non sovrapporsi all'avatar.
 */
function geometry(spec: SlideVideoSpec, pos?: PipPosition): Geometry {
  const { width, height } = spec.canvas;
  const s = width / 1920;
  const M = 48 * s;
  if (spec.layout === 'pip') {
    const d = 320 * s;
    const p = pos ?? spec.pipPosition ?? 'bottom-right';
    const right = p.endsWith('right');
    const bottom = p.startsWith('bottom');
    const capH = 190 * s;
    const capTop = height - 230 * s;
    const caption = bottom
      ? {
          left: right ? M : M + d + 24 * s,
          top: capTop,
          width: width - 2 * M - d - 24 * s,
          height: capH,
        }
      : { left: M, top: capTop, width: width - 2 * M, height: capH };
    return {
      s,
      slide: { left: 0, top: 0, width, height },
      avatar: {
        left: right ? width - d - M : M,
        top: bottom ? height - d - M - 8 * s : M,
        width: d,
        height: d,
      },
      caption,
      panel: { left: 0, top: 0, width: 0, height: 0 },
      radius: d / 2,
    };
  }
  const slideW = 1280 * s;
  const slideH = 720 * s;
  const gap = 32 * s;
  const rightLeft = M + slideW + gap;
  // Senza sottotitoli incisi la fascia sotto la slide resterebbe vuota: il blocco slide +
  // pannello si centra verticalmente e il pannello ha l'altezza che gli serve.
  const panelH = spec.burnCaptions ? height - (M + slideH + 24 * s) - M : 150 * s;
  const top = spec.burnCaptions ? M : Math.round((height - (slideH + 24 * s + panelH)) / 2);
  return {
    s,
    slide: { left: M, top, width: slideW, height: slideH },
    avatar: { left: rightLeft, top, width: width - rightLeft - M, height: slideH },
    caption: { left: M, top: top + slideH + 24 * s, width: slideW, height: panelH },
    panel: { left: rightLeft, top: top + slideH + 24 * s, width: width - rightLeft - M, height: panelH },
    radius: 14 * s,
  };
}

const boxStyle = (b: Box): React.CSSProperties => ({
  position: 'absolute',
  left: b.left,
  top: b.top,
  width: b.width,
  height: b.height,
});

/* ------------------------- Slide testuale (extra) --------------------------- */
/** Slide disegnata dal testo: titolo e punti, nei colori del tema. Usata per le slide "extra" senza immagine. */
const TextSlide: React.FC<{ title: string; bullets: string[]; spec: SlideVideoSpec; g: Geometry }> = ({
  title,
  bullets,
  spec,
  g,
}) => (
  <div
    style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: `${72 * g.s}px ${88 * g.s}px`,
      background: `linear-gradient(135deg, #000 0%, ${spec.theme.bg} 100%)`,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      gap: 36 * g.s,
    }}
  >
    <div style={{ width: 96 * g.s, height: 8 * g.s, background: spec.theme.accent, borderRadius: 4 * g.s }} />
    <div style={{ fontSize: 68 * g.s, fontWeight: 800, lineHeight: 1.1, color: spec.theme.text }}>{title}</div>
    <ul style={{ margin: 0, paddingLeft: 40 * g.s, display: 'flex', flexDirection: 'column', gap: 20 * g.s }}>
      {bullets.slice(0, 6).map((b, i) => (
        <li key={i} style={{ fontSize: 38 * g.s, lineHeight: 1.3, color: spec.theme.text, opacity: 0.92 }}>
          {b}
        </li>
      ))}
    </ul>
  </div>
);
/* -------------------------------- Scena ------------------------------------ */

const SlideScene: React.FC<{ spec: SlideVideoSpec; slideIndex: number; g: Geometry }> = ({
  spec,
  slideIndex,
  g,
}) => {
  const slide = spec.slides[slideIndex]!;
  const frame = useCurrentFrame();
  const pip = spec.layout === 'pip';
  // Ingresso morbido della slide (dissolvenza) a ogni cambio.
  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill>
      <div
        style={{
          ...boxStyle(g.slide),
          opacity: fadeIn,
          borderRadius: pip ? 0 : g.radius,
          overflow: 'hidden',
          background: '#000',
          boxShadow: pip ? 'none' : '0 12px 40px rgba(0,0,0,0.45)',
        }}
      >
        {slide.imageUrl ? (
          <Img src={slide.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <TextSlide title={slide.textSlide?.title ?? slide.title ?? ''} bullets={slide.textSlide?.bullets ?? []} spec={spec} g={g} />
        )}
      </div>

      <div
        style={{
          ...boxStyle(g.avatar),
          borderRadius: g.radius,
          overflow: 'hidden',
          background: '#111827',
          border: pip ? `${5 * g.s}px solid ${spec.theme.accent}` : `${2 * g.s}px solid rgba(255,255,255,0.12)`,
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        }}
      >
        {/* La clip porta anche l'audio della narrazione. Ritaglio centrato sul
            viso: nel formato 16:9 l'avatar sta al centro. */}
        <OffthreadVideo
          src={slide.clipUrl}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: '50% 20%',
            transform: pip ? 'scale(1.25)' : 'none',
            transformOrigin: '50% 30%',
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

/* ------------------------------ Sottotitoli -------------------------------- */

const Captions: React.FC<{ cues: GlobalCue[]; spec: SlideVideoSpec; timeline: SlideTimeline }> = ({
  cues,
  spec,
  timeline,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  // Il box dei sottotitoli segue la posizione dell'avatar della slide corrente.
  const idx = Math.max(
    0,
    timeline.entries.findIndex((e) => frame >= e.startFrame && frame < e.startFrame + e.durationFrames),
  );
  const g = geometry(spec, spec.slides[idx]?.pipPosition);
  const cue = activeCueAt(cues, t);
  if (!cue) return null;
  const sinceStart = (t - cue.start) * fps;
  const opacity = interpolate(sinceStart, [0, 5], [0, 1], { extrapolateRight: 'clamp' });
  const pip = spec.layout === 'pip';

  return (
    <div
      style={{
        ...boxStyle(g.caption),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: `${12 * g.s}px ${28 * g.s}px`,
        boxSizing: 'border-box',
        borderRadius: 16 * g.s,
        background: pip ? 'rgba(10,14,20,0.78)' : 'rgba(255,255,255,0.05)',
        border: pip ? 'none' : '1px solid rgba(255,255,255,0.08)',
        overflow: 'hidden',
        opacity,
      }}
    >
      <span
        style={{
          fontSize: 40 * g.s,
          lineHeight: 1.3,
          fontWeight: 500,
          textAlign: 'center',
          color: spec.theme.text,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {cue.text}
      </span>
    </div>
  );
};

/* --------------------------- Pannello laterale ----------------------------- */

const SidePanel: React.FC<{ spec: SlideVideoSpec; timeline: SlideTimeline; g: Geometry }> = ({
  spec,
  timeline,
  g,
}) => {
  const frame = useCurrentFrame();
  const total = spec.slides.length;
  const current = Math.max(
    0,
    timeline.entries.findIndex((e) => frame >= e.startFrame && frame < e.startFrame + e.durationFrames),
  );
  const progress = timeline.totalFrames > 0 ? Math.min(1, frame / timeline.totalFrames) : 0;
  const pad = (n: number): string => String(n).padStart(2, '0');

  // PiP: solo una sottile barra di avanzamento in fondo al video.
  if (spec.layout === 'pip') {
    return (
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          height: 8 * g.s,
          width: `${progress * 100}%`,
          background: spec.theme.accent,
        }}
      />
    );
  }

  return (
    <div
      style={{
        ...boxStyle(g.panel),
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: `${6 * g.s}px ${4 * g.s}px`,
        boxSizing: 'border-box',
      }}
    >
      <div>
        {spec.sectionTitle && (
          <div
            style={{
              fontSize: 22 * g.s,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: spec.theme.accent,
              lineHeight: 1.25,
            }}
          >
            {spec.sectionTitle}
          </div>
        )}
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 * g.s, marginBottom: 14 * g.s }}>
          <span style={{ fontSize: 64 * g.s, fontWeight: 800, lineHeight: 1 }}>{pad(current + 1)}</span>
          <span style={{ fontSize: 28 * g.s, fontWeight: 600, opacity: 0.55 }}>/ {pad(total)}</span>
        </div>
        <div style={{ height: 8 * g.s, borderRadius: 999, background: 'rgba(255,255,255,0.14)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress * 100}%`, background: spec.theme.accent }} />
        </div>
      </div>
    </div>
  );
};
