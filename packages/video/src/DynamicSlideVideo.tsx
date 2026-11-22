import React from 'react';
import { SlideMedia } from './components/SlideMedia.js';
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {
  activeCueAt,
  avatarCrop,
  avatarLookFilter,
  avatarRingColor,
  avatarWarmthOverlay,
  dynamicShotGeometry,
  slideAvatarFrame,
  slideAvatarLook,
  computeSlideTimeline,
  globalCues,
  type GlobalCue,
  type PipPosition,
  type SlideShot,
  type SlideTimeline,
  type SlideVideoSpec,
} from '@scorm/contracts';

/**
 * Layout "dynamic" (regia): ogni slide ha un'INQUADRATURA (presenter, side, focus, mini) e il
 * passaggio tra un'inquadratura e la successiva è animato con una molla smorzata: il
 * riquadro dell'avatar si sposta, cambia dimensione e passa da rettangolo a cerchio, la
 * slide si ridimensiona da card a tutto schermo. Le slide entrano in dissolvenza con un
 * leggerissimo zoom continuo ("respiro"), lo sfondo è la slide stessa sfocata nei colori del
 * brand. Movimenti brevi e coerenti: il premium è nella misura, non nella quantità.
 *
 * Tutta la geometria è progettata su 1920×1080 e scalata sul canvas reale.
 */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Raggio degli angoli (w/2 = cerchio). */
  r: number;
}
interface ShotFrame {
  slide: Rect;
  avatar: Rect & { zoom: number; ring: number; shadow: number };
  /** 0..1: quanto lo sfondo sfocato è visibile (le slide a tutto schermo lo coprono). */
  backdrop: number;
  /** 0..1: quanto la slide occupa lo schermo intero (per nascondere il chip di sezione). */
  full: number;
}

const W = 1920;
const H = 1080;

/** Geometria di riferimento di ogni inquadratura: condivisa con l'anteprima della regia. */
function shotFrame(shot: SlideShot, corner: PipPosition, look: SlideVideoSpec['avatarLook']): ShotFrame {
  return dynamicShotGeometry(shot, corner, look);
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
function mixRect<T extends Rect>(a: T, b: T, t: number): T {
  const out = { ...b };
  for (const k of Object.keys(b) as Array<keyof T>) {
    const av = a[k];
    const bv = b[k];
    if (typeof av === 'number' && typeof bv === 'number') (out[k] as number) = lerp(av, bv, t);
  }
  return out;
}
function mixFrame(a: ShotFrame, b: ShotFrame, t: number): ShotFrame {
  return {
    slide: mixRect(a.slide, b.slide, t),
    avatar: mixRect(a.avatar, b.avatar, t),
    backdrop: lerp(a.backdrop, b.backdrop, t),
    full: lerp(a.full, b.full, t),
  };
}

function slideIndexAt(timeline: SlideTimeline, frame: number): number {
  const i = timeline.entries.findIndex((e) => frame >= e.startFrame && frame < e.startFrame + e.durationFrames);
  return i === -1 ? Math.max(0, timeline.entries.length - 1) : i;
}

/** Geometria al frame assoluto: transizione a molla dall'inquadratura precedente. */
function frameAt(spec: SlideVideoSpec, timeline: SlideTimeline, frame: number, fps: number): ShotFrame {
  const i = slideIndexAt(timeline, frame);
  const corner = (k: number): PipPosition => spec.slides[k]?.pipPosition ?? spec.pipPosition ?? 'bottom-right';
  const shot = (k: number): SlideShot => spec.slides[k]?.shot ?? 'focus';
  const lookOf = (k: number) => slideAvatarLook(spec.avatarLook, spec.slides[k]?.avatarLook);
  const cur = shotFrame(shot(i), corner(i), lookOf(i));
  if (i === 0) return cur;
  const prev = shotFrame(shot(i - 1), corner(i - 1), lookOf(i - 1));
  const local = frame - timeline.entries[i]!.startFrame;
  const t = spring({ frame: local, fps, config: { damping: 200, mass: 0.9, stiffness: 120 }, durationInFrames: Math.round(fps * 0.9) });
  return mixFrame(prev, cur, t);
}

const S = (n: number, s: number): number => n * s;

export const DynamicSlideVideo: React.FC<{ spec: SlideVideoSpec }> = ({ spec }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const s = width / W;
  const timeline = React.useMemo(() => computeSlideTimeline(spec.slides, fps), [spec.slides, fps]);
  const cues = React.useMemo(() => globalCues(spec.slides, timeline), [spec.slides, timeline]);
  const g = frameAt(spec, timeline, frame, fps);
  const idx = slideIndexAt(timeline, frame);
  // Entrata di tutto il video (primi ~0.6 s) e uscita finale (ultimi ~0.5 s).
  const intro = interpolate(frame, [0, Math.round(fps * 0.6)], [0, 1], { extrapolateRight: 'clamp' });
  const outro = interpolate(frame, [timeline.totalFrames - Math.round(fps * 0.5), timeline.totalFrames], [1, 0], {
    extrapolateLeft: 'clamp',
  });
  const fadeIn = Math.min(intro, outro);
  /** Dissolvenza incrociata tra slide (frame). */
  const XFADE = Math.round(fps * 0.4);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: spec.theme.bg,
        color: spec.theme.text,
        fontFamily: 'Inter, Roboto, "Helvetica Neue", Arial, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Sfondo: tinta del brand con una luce morbida + slide corrente sfocata. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(1200px 800px at 18% 12%, ${hexA(spec.theme.accent, 0.16)}, transparent 60%), radial-gradient(900px 700px at 85% 95%, ${hexA(spec.theme.accent, 0.08)}, transparent 60%)`,
        }}
      />
      {spec.slides.map((slide, i) => {
        const e = timeline.entries[i]!;
        return (
          <Sequence key={`bg-${slide.id}`} from={e.startFrame} durationInFrames={e.durationFrames + XFADE} layout="none">
            <Backdrop spec={spec} index={i} opacity={g.backdrop * 0.55 * fadeIn} xfade={XFADE} />
          </Sequence>
        );
      })}

      {/* Slide: ogni slide entra in dissolvenza sopra la precedente, nel riquadro corrente. */}
      {spec.slides.map((slide, i) => {
        const e = timeline.entries[i]!;
        return (
          <Sequence key={`sl-${slide.id}`} from={e.startFrame} durationInFrames={e.durationFrames + XFADE} layout="none">
            <SlideLayer spec={spec} index={i} rect={g.slide} s={s} xfade={XFADE} duration={e.durationFrames} fade={fadeIn} />
          </Sequence>
        );
      })}

      {/* Avatar: una clip per slide (porta anche l'audio), nel riquadro animato. */}
      {spec.slides.map((slide, i) => {
        const e = timeline.entries[i]!;
        return (
          <Sequence key={`av-${slide.id}`} from={e.startFrame} durationInFrames={e.durationFrames} layout="none">
            <AvatarLayer
              src={slide.clipUrl}
              rect={g.avatar}
              s={s}
              accent={avatarRingColor(slideAvatarLook(spec.avatarLook, slide.avatarLook), spec.theme.accent)}
              fade={fadeIn}
              frame={slideAvatarFrame(spec.avatarFrame, slide.avatarFrame)}
              look={slideAvatarLook(spec.avatarLook, slide.avatarLook)}
            />
          </Sequence>
        );
      })}

      <SectionChip spec={spec} timeline={timeline} index={idx} hidden={g.full} s={s} fade={fadeIn} />
      {spec.burnCaptions && <DynCaptions cues={cues} spec={spec} g={g} s={s} />}
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          height: S(6, s),
          width: `${(timeline.totalFrames > 0 ? Math.min(1, frame / timeline.totalFrames) : 0) * 100}%`,
          background: spec.theme.accent,
          opacity: 0.9 * fadeIn,
        }}
      />
    </AbsoluteFill>
  );
};

/* -------------------------------- Livelli --------------------------------- */

const Backdrop: React.FC<{ spec: SlideVideoSpec; index: number; opacity: number; xfade: number }> = ({
  spec,
  index,
  opacity,
  xfade,
}) => {
  const local = useCurrentFrame();
  const slide = spec.slides[index]!;
  if (!slide.imageUrl || opacity <= 0.01) return null;
  const a = index === 0 ? 1 : interpolate(local, [0, xfade], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity: opacity * a }}>
      <Img
        src={slide.imageUrl}
        style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(42px) saturate(1.2)', transform: 'scale(1.18)' }}
      />
    </AbsoluteFill>
  );
};

const SlideLayer: React.FC<{
  spec: SlideVideoSpec;
  index: number;
  rect: Rect;
  s: number;
  xfade: number;
  duration: number;
  fade: number;
}> = ({ spec, index, rect, s, xfade, duration, fade }) => {
  const local = useCurrentFrame();
  const slide = spec.slides[index]!;
  // Dissolvenza in entrata (la precedente resta sotto per `xfade` frame) e "respiro" continuo.
  const a = index === 0 ? 1 : interpolate(local, [0, xfade], [0, 1], { extrapolateRight: 'clamp' });
  const enter = index === 0 ? 1 : interpolate(local, [0, xfade * 2], [1.025, 1], { extrapolateRight: 'clamp' });
  // Il "respiro" (lento ingrandimento) solo sulle immagini: su un video in movimento distrae.
  const breathe = slide.video ? 1 : 1 + 0.018 * Math.min(1, local / Math.max(1, duration));
  const isCard = rect.r > 1;
  return (
    <div
      style={{
        position: 'absolute',
        left: S(rect.x, s),
        top: S(rect.y, s),
        width: S(rect.w, s),
        height: S(rect.h, s),
        borderRadius: S(rect.r, s),
        overflow: 'hidden',
        opacity: a * fade,
        background: '#000',
        boxShadow: isCard ? `0 ${S(24, s)}px ${S(70, s)}px rgba(0,0,0,0.55)` : 'none',
        outline: isCard ? `${S(1, s)}px solid rgba(255,255,255,0.08)` : 'none',
      }}
    >
      <div style={{ width: '100%', height: '100%', transform: `scale(${enter * breathe})`, transformOrigin: '50% 45%' }}>
        {slide.video || slide.imageUrl ? (
          <SlideMedia slide={slide} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <TextCard
            title={slide.textSlide?.title ?? slide.title ?? ''}
            bullets={slide.textSlide?.bullets ?? []}
            accent={spec.theme.accent}
            text={spec.theme.text}
            bg={spec.theme.bg}
            scale={(S(rect.w, s) / W) * 1}
          />
        )}
      </div>
    </div>
  );
};

const AvatarLayer: React.FC<{
  src: string;
  rect: ShotFrame['avatar'];
  s: number;
  accent: string;
  fade: number;
  frame: SlideVideoSpec['avatarFrame'];
  look: SlideVideoSpec['avatarLook'];
}> = ({ src, rect, s, accent, fade, frame, look }) => (
  <div
    style={{
      position: 'absolute',
      left: S(rect.x, s),
      top: S(rect.y, s),
      width: S(rect.w, s),
      height: S(rect.h, s),
      borderRadius: S(rect.r, s),
      overflow: 'hidden',
      opacity: fade,
      background: '#111',
      boxShadow: `0 ${S(18, s)}px ${S(60, s)}px rgba(0,0,0,${0.55 * rect.shadow}), 0 0 0 ${S(rect.ring, s)}px ${accent}`,
    }}
  >
    {/* Ritaglio sulla persona: il punto scelto (avatarFrame) al centro, più stretto nei cerchi. */}
    <OffthreadVideo
      src={src}
      style={{ position: 'absolute', ...cropStyle(S(rect.w, s), S(rect.h, s), frame, rect.zoom), filter: avatarLookFilter(look) }}
    />
    {avatarWarmthOverlay(look) && <div style={{ position: 'absolute', inset: 0, ...avatarWarmthOverlay(look)! }} />}
  </div>
);

/** Titolo della sezione e numero della slide, visibili quando la slide non è a tutto schermo. */
const SectionChip: React.FC<{
  spec: SlideVideoSpec;
  timeline: SlideTimeline;
  index: number;
  hidden: number;
  s: number;
  fade: number;
}> = ({ spec, timeline, index, hidden, s, fade }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - Math.round(fps * 0.3), fps, config: { damping: 200 }, durationInFrames: Math.round(fps * 0.8) });
  const pad = (n: number): string => String(n).padStart(2, '0');
  const opacity = (1 - hidden) * fade * enter;
  if (opacity <= 0.01) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: S(96, s),
        top: S(64, s),
        display: 'flex',
        alignItems: 'center',
        gap: S(18, s),
        opacity,
        transform: `translateY(${S(12 * (1 - enter), s)}px)`,
      }}
    >
      <div style={{ width: S(6, s), height: S(44, s), borderRadius: S(3, s), background: spec.theme.accent }} />
      <div>
        {spec.sectionTitle && (
          <div style={{ fontSize: S(24, s), fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: spec.theme.text }}>
            {spec.sectionTitle}
          </div>
        )}
        <div style={{ fontSize: S(18, s), fontWeight: 600, letterSpacing: '0.08em', color: hexA(spec.theme.text, 0.6) }}>
          {pad(index + 1)} / {pad(timeline.entries.length)}
        </div>
      </div>
    </div>
  );
};

/** Sottotitoli incisi (solo su richiesta): fascia bassa che evita l'avatar. */
const DynCaptions: React.FC<{ cues: GlobalCue[]; spec: SlideVideoSpec; g: ShotFrame; s: number }> = ({ cues, spec, g, s }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cue = activeCueAt(cues, frame / fps);
  if (!cue) return null;
  let left = 120;
  let right = W - 120;
  const a = g.avatar;
  if (a.y + a.h > H - 210) {
    if (a.x > W / 2) right = Math.min(right, a.x - 32);
    else left = Math.max(left, a.x + a.w + 32);
  }
  return (
    <div
      style={{
        position: 'absolute',
        left: S(left, s),
        width: S(right - left, s),
        bottom: S(40, s),
        padding: `${S(14, s)}px ${S(28, s)}px`,
        boxSizing: 'border-box',
        borderRadius: S(16, s),
        background: 'rgba(8,10,14,0.78)',
        textAlign: 'center',
        fontSize: S(38, s),
        lineHeight: 1.3,
        fontWeight: 500,
        color: spec.theme.text,
      }}
    >
      {cue.text}
    </div>
  );
};

/** Slide "extra" disegnata dal testo, nei colori del brand. */
const TextCard: React.FC<{ title: string; bullets: string[]; accent: string; text: string; bg: string; scale: number }> = ({
  title,
  bullets,
  accent,
  text,
  bg,
  scale,
}) => (
  <div
    style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: `${72 * scale}px ${88 * scale}px`,
      background: `linear-gradient(135deg, #000 0%, ${bg} 100%)`,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      gap: 36 * scale,
    }}
  >
    <div style={{ width: 96 * scale, height: 8 * scale, background: accent, borderRadius: 4 * scale }} />
    <div style={{ fontSize: 68 * scale, fontWeight: 800, lineHeight: 1.1, color: text }}>{title}</div>
    <ul style={{ margin: 0, paddingLeft: 40 * scale, display: 'flex', flexDirection: 'column', gap: 20 * scale }}>
      {bullets.slice(0, 6).map((b, i) => (
        <li key={i} style={{ fontSize: 38 * scale, lineHeight: 1.3, color: text, opacity: 0.92 }}>
          {b}
        </li>
      ))}
    </ul>
  </div>
);

/** Colore esadecimale con trasparenza (accetta #rgb e #rrggbb; altrimenti restituisce il colore). */
function hexA(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const h = m[1]!.length === 3 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function cropStyle(
  w: number,
  h: number,
  frame: SlideVideoSpec['avatarFrame'],
  zoom: number,
): React.CSSProperties {
  const c = avatarCrop(w, h, frame, zoom);
  return { left: c.left, top: c.top, width: c.width, height: c.height, maxWidth: 'none' };
}
