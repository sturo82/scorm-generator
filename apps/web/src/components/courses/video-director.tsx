'use client';

import * as React from 'react';
import {
  Check,
  Clapperboard,
  Eye,
  Hand,
  Loader2,
  Move,
  RotateCcw,
  Sparkles,
  SunMedium,
  Undo2,
  Volume2,
  VolumeX,
  Wand2,
} from 'lucide-react';
import {
  avatarCrop,
  avatarLookFilter,
  avatarOverlayRadius,
  avatarRingColor,
  avatarWarmthOverlay,
  dynamicShotGeometry,
  resolveAvatarLook,
  slideAvatarFrame,
  slideAvatarLook,
  type AvatarLook,
} from '@scorm/contracts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CreditCost } from '@/components/ui/credit-cost';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import {
  useBrand,
  useCourse,
  useRemasterSlideLesson,
  useSlideClips,
  useSlideDirection,
  useSlideImport,
  useSlideLesson,
} from '@/lib/api/hooks';
import type { PipPosition, SlideLayout, SlideShot } from '@/lib/api/types';

const STAGE_W = 1920;
const STAGE_H = 1080;
const DEFAULT_BG = '#0b0f14';
const DEFAULT_ACCENT = '#f5b700';

type Frame = { x: number; y: number; zoom: number };
interface Draft {
  layout: SlideLayout;
  pipPosition: PipPosition;
  slidePositions: Record<string, PipPosition>;
  slideShots: Record<string, SlideShot>;
  avatarFrame: Frame;
  avatarLook: AvatarLook;
  /** Modifiche solo per alcune slide (chiave = numero della slide): si sommano a quelle generali. */
  slideLooks: Record<string, Partial<AvatarLook>>;
  slideFrames: Record<string, Partial<Frame>>;
}

/** Toglie le modifiche per slide rimaste vuote. */
function compact<T extends object>(m: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(m).filter(([, v]) => Object.keys(v).length > 0));
}

type Rect = { x: number; y: number; w: number; h: number; r: number };
type AvatarRect = Rect & { zoom: number; ring: number; shadow: number };

/** Disposizioni offerte, con una descrizione di una riga. */
const LAYOUTS: Array<{ id: SlideLayout; label: string; hint: string }> = [
  { id: 'dynamic', label: 'Regia automatica', hint: 'Alterna presentatore, affiancata e slide a tutto schermo' },
  { id: 'pip', label: 'Avatar sulla slide', hint: 'Slide a tutto schermo, avatar in sovrimpressione' },
  { id: 'split', label: 'Affiancati', hint: 'Slide a sinistra, avatar a destra' },
];

const SHOTS: Array<{ id: SlideShot | 'auto'; label: string }> = [
  { id: 'auto', label: 'Automatica' },
  { id: 'presenter', label: 'Presentatore' },
  { id: 'side', label: 'Affiancata' },
  { id: 'focus', label: 'Sovrimpressione' },
  { id: 'mini', label: 'Discreta' },
];

const CORNERS: Array<{ id: PipPosition; label: string }> = [
  { id: 'top-left', label: 'In alto a sinistra' },
  { id: 'top-right', label: 'In alto a destra' },
  { id: 'bottom-left', label: 'In basso a sinistra' },
  { id: 'bottom-right', label: 'In basso a destra' },
];

/** Correzioni pronte per l'immagine: un clic e si vede il risultato. */
const PRESETS: Array<{ id: string; label: string; look: Pick<AvatarLook, 'brightness' | 'contrast' | 'saturation' | 'warmth'> }> = [
  { id: 'original', label: 'Originale', look: { brightness: 0, contrast: 0, saturation: 0, warmth: 0 } },
  { id: 'auto', label: 'Migliora', look: { brightness: 6, contrast: 10, saturation: 8, warmth: 4 } },
  { id: 'bright', label: 'Luminoso', look: { brightness: 15, contrast: 5, saturation: 5, warmth: 0 } },
  { id: 'warm', label: 'Caldo', look: { brightness: 4, contrast: 4, saturation: 6, warmth: 22 } },
  { id: 'cool', label: 'Freddo', look: { brightness: 2, contrast: 6, saturation: -4, warmth: -20 } },
  { id: 'pro', label: 'Professionale', look: { brightness: 3, contrast: 14, saturation: -8, warmth: 0 } },
];

const sameLook = (a: AvatarLook, b: Pick<AvatarLook, 'brightness' | 'contrast' | 'saturation' | 'warmth'>) =>
  a.brightness === b.brightness && a.contrast === b.contrast && a.saturation === b.saturation && a.warmth === b.warmth;

/** Geometria dell'avatar e della slide sul canvas 1920x1080, identica a quella del montaggio. */
function stageGeometry(d: Draft, look: AvatarLook, shot: SlideShot, corner: PipPosition): { slide: Rect; avatar: AvatarRect; backdrop: number } {
  if (d.layout === 'dynamic') {
    const g = dynamicShotGeometry(shot, corner, look);
    return { slide: g.slide, avatar: g.avatar, backdrop: g.backdrop };
  }
  if (d.layout === 'pip') {
    const size = 320 * look.size;
    const M = 48;
    return {
      slide: { x: 0, y: 0, w: STAGE_W, h: STAGE_H, r: 0 },
      avatar: {
        x: corner.endsWith('right') ? STAGE_W - size - M : M,
        y: corner.startsWith('bottom') ? STAGE_H - size - M - 8 : M,
        w: size,
        h: size,
        r: avatarOverlayRadius(look.shape, size),
        zoom: 1.25,
        ring: look.ring === 'none' ? 0 : 5,
        shadow: look.shadow ? 1 : 0,
      },
      backdrop: 0,
    };
  }
  return {
    slide: { x: 48, y: 93, w: 1280, h: 720, r: 14 },
    avatar: { x: 1360, y: 93, w: 512, h: 720, r: 14, zoom: 1, ring: 0, shadow: look.shadow ? 1 : 0 },
    backdrop: 0,
  };
}

/** Larghezza di un elemento, aggiornata al ridimensionamento (ref a callback: l'elemento può comparire dopo). */
function useElementWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [w, setW] = React.useState(0);
  const ro = React.useRef<ResizeObserver | null>(null);
  const ref = React.useCallback((el: T | null) => {
    ro.current?.disconnect();
    if (!el) return;
    setW(el.getBoundingClientRect().width);
    ro.current = new ResizeObserver(([e]) => setW(e?.contentRect.width ?? 0));
    ro.current.observe(el);
  }, []);
  React.useEffect(() => () => ro.current?.disconnect(), []);
  return [ref, w];
}

/**
 * Regia del video da slide: anteprima dal vivo con la clip vera dell'avatar e, accanto, i comandi
 * di disposizione, inquadratura e resa dell'immagine. Ogni modifica si vede subito; con «Applica»
 * si rimonta il video (nessuna clip da rigenerare). Usa la stessa geometria e gli stessi filtri del
 * montaggio, così quello che vedi è quello che ottieni.
 */
export function VideoDirector({ courseId, importId, library = false }: { courseId: string; importId: string; library?: boolean }) {
  const toast = useToast();
  const lesson = useSlideLesson(courseId, importId);
  const clips = useSlideClips(courseId, importId);
  const imp = useSlideImport(courseId, importId);
  const remaster = useRemasterSlideLesson(courseId, importId);
  const course = useCourse(library ? '' : courseId);
  const view = lesson.data && 'step' in lesson.data ? lesson.data : null;
  const clipsView = clips.data && 'clips' in clips.data ? clips.data : null;
  const brand = useBrand((library ? view?.brandId : course.data?.primaryBrandId) ?? '');

  const saved = React.useMemo<Draft | null>(
    () =>
      view
        ? {
            layout: view.layout,
            pipPosition: view.pipPosition ?? 'bottom-right',
            slidePositions: view.slidePositions ?? {},
            slideShots: view.slideShots ?? {},
            avatarFrame: { x: view.avatarFrame?.x ?? 50, y: view.avatarFrame?.y ?? 22, zoom: view.avatarFrame?.zoom ?? 1 },
            avatarLook: resolveAvatarLook(view.avatarLook),
            slideLooks: view.slideLooks ?? {},
            slideFrames: view.slideFrames ?? {},
          }
        : null,
    // Si riallinea quando il server conferma un nuovo montaggio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view?.updatedAt, view?.status],
  );
  const [draft, setDraft] = React.useState<Draft | null>(saved);
  React.useEffect(() => setDraft(saved), [saved]);

  const direction = useSlideDirection(courseId, importId, draft?.layout === 'dynamic');
  const included = React.useMemo(() => (clipsView?.clips ?? []).filter((c) => c.clipUrl).sort((a, b) => a.index - b.index), [clipsView]);
  const [sel, setSel] = React.useState<number | null>(null);
  const current = included.find((c) => c.index === sel) ?? included[0];
  const [muted, setMuted] = React.useState(true);
  const [compare, setCompare] = React.useState(false);
  // Le modifiche di avatar e immagine valgono per tutte le slide o solo per quella selezionata.
  const [scope, setScope] = React.useState<'all' | 'slide'>('all');
  const [stageRef, stageW] = useElementWidth<HTMLDivElement>();
  const drag = React.useRef<{ x: number; y: number; fx: number; fy: number } | null>(null);

  if (lesson.isLoading || clips.isLoading || !draft || !saved) return <Skeleton className="h-[420px] w-full" />;
  if (!view || view.status === 'failed' || !current) {
    return <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">La regia è disponibile quando il video è stato montato.</p>;
  }

  const d = draft;
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  const running = view.status === 'running';
  const auto = direction.data?.items.find((x) => x.index === current.index);
  const key = String(current.index);
  const shot: SlideShot = d.slideShots[key] ?? auto?.shot ?? 'focus';
  const corner: PipPosition = d.layout === 'pip' ? (d.slidePositions[key] ?? d.pipPosition) : (d.slidePositions[key] ?? auto?.corner ?? 'bottom-right');
  const ownLook = d.slideLooks[key];
  const ownFrame = d.slideFrames[key];
  const hasOwn = Boolean((ownLook && Object.keys(ownLook).length) || (ownFrame && Object.keys(ownFrame).length));
  const effLook = slideAvatarLook(d.avatarLook, ownLook);
  const effFrame = slideAvatarFrame(d.avatarFrame, ownFrame);
  const customCount = new Set([...Object.keys(compact(d.slideLooks)), ...Object.keys(compact(d.slideFrames))]).size;
  const g = stageGeometry(d, effLook, shot, corner);
  const overlay = d.layout === 'pip' || (d.layout === 'dynamic' && (shot === 'focus' || shot === 'mini'));
  const sc = stageW / STAGE_W;
  const accent = [brand.data?.colors.primary, brand.data?.colors.secondary].find((c) => c && luminance(c) > 0.18) ?? DEFAULT_ACCENT;
  const look = compare ? resolveAvatarLook({}) : effLook;
  const crop = avatarCrop(g.avatar.w * sc, g.avatar.h * sc, effFrame, g.avatar.zoom);
  const warm = avatarWarmthOverlay(look);
  const thumb = imp.data?.slides.find((s) => s.index === current.index)?.imageUrl;
  const totalMin = included.reduce((n, c) => n + (c.durationSec ?? 0), 0) / 60;

  const set = (patch: Partial<Draft>) => setDraft({ ...d, ...patch });
  const setLook = (patch: Partial<AvatarLook>) =>
    scope === 'slide'
      ? set({ slideLooks: { ...d.slideLooks, [key]: { ...(d.slideLooks[key] ?? {}), ...patch } } })
      : set({ avatarLook: { ...d.avatarLook, ...patch } });
  const setFrame = (patch: Partial<Frame>) =>
    scope === 'slide'
      ? set({ slideFrames: { ...d.slideFrames, [key]: { ...(d.slideFrames[key] ?? {}), ...patch } } })
      : set({ avatarFrame: { ...d.avatarFrame, ...patch } });
  /** Toglie le modifiche proprie della slide: torna alle impostazioni generali. */
  const clearOwn = () => {
    const looks = { ...d.slideLooks };
    const frames = { ...d.slideFrames };
    delete looks[key];
    delete frames[key];
    set({ slideLooks: looks, slideFrames: frames });
  };
  /** Le impostazioni di questa slide diventano quelle di tutto il video. */
  const promoteOwn = () => {
    const looks = { ...d.slideLooks };
    const frames = { ...d.slideFrames };
    delete looks[key];
    delete frames[key];
    set({ avatarLook: effLook, avatarFrame: effFrame, slideLooks: looks, slideFrames: frames });
    setScope('all');
  };

  // Trascinando l'avatar si sposta il punto del volto al centro del riquadro.
  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, fx: effFrame.x, fy: effFrame.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    const s = drag.current;
    if (!s || crop.width <= 0) return;
    const nx = Math.min(100, Math.max(0, s.fx - ((e.clientX - s.x) / crop.width) * 100));
    const ny = Math.min(100, Math.max(0, s.fy - ((e.clientY - s.y) / crop.height) * 100));
    setFrame({ x: Math.round(nx), y: Math.round(ny) });
  }

  async function apply() {
    try {
      await remaster.mutateAsync({
        layout: d.layout,
        pipPosition: d.pipPosition,
        slidePositions: d.layout === 'split' ? {} : d.slidePositions,
        slideShots: d.layout === 'dynamic' ? d.slideShots : {},
        avatarFrame: d.avatarFrame,
        avatarLook: d.avatarLook,
        slideLooks: compact(d.slideLooks),
        slideFrames: compact(d.slideFrames),
      });
      toast.show('Sto rimontando il video con la nuova regia: nessuna clip viene rigenerata', 'success');
    } catch (err) {
      toast.show(err instanceof Error ? err.message.replace(/^API \d+:\s*/, '').slice(0, 160) : 'Rimontaggio non avviato', 'error');
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Anteprima */}
        <div className="space-y-2">
          <div
            ref={stageRef}
            className="relative aspect-video w-full overflow-hidden rounded-xl border shadow-sm"
            style={{ background: DEFAULT_BG }}
          >
            {stageW > 0 && (
              <>
                <div
                  aria-hidden
                  className="absolute inset-0"
                  style={{ background: `radial-gradient(60% 70% at 18% 12%, ${hexA(accent, 0.16)}, transparent 60%)` }}
                />
                {thumb && g.backdrop > 0 && (
                  // eslint-disable-next-line @next/next/no-img-element -- sfondo sfocato della slide
                  <img src={thumb} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover blur-2xl" style={{ opacity: g.backdrop * 0.55 }} />
                )}
                <div
                  className="absolute overflow-hidden bg-black transition-all duration-500 ease-out"
                  style={{ left: g.slide.x * sc, top: g.slide.y * sc, width: g.slide.w * sc, height: g.slide.h * sc, borderRadius: g.slide.r * sc }}
                >
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element -- slide
                    <img src={thumb} alt={`Slide ${current.index}`} className="size-full object-contain" />
                  ) : (
                    <div className="grid size-full place-items-center p-4 text-center text-sm text-white/80">Slide {current.index}</div>
                  )}
                </div>
                <div
                  role="img"
                  aria-label="Avatar: trascina per centrare il volto"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={() => (drag.current = null)}
                  className="group absolute cursor-grab touch-none overflow-hidden transition-[left,top,width,height,border-radius] duration-500 ease-out active:cursor-grabbing"
                  style={{
                    left: g.avatar.x * sc,
                    top: g.avatar.y * sc,
                    width: g.avatar.w * sc,
                    height: g.avatar.h * sc,
                    borderRadius: g.avatar.r * sc,
                    background: '#111',
                    boxShadow: [
                      g.avatar.shadow ? `0 ${18 * sc}px ${60 * sc}px rgba(0,0,0,${0.55 * g.avatar.shadow})` : '',
                      g.avatar.ring ? `0 0 0 ${g.avatar.ring * sc}px ${avatarRingColor(effLook, accent)}` : '',
                    ]
                      .filter(Boolean)
                      .join(', ') || 'none',
                  }}
                >
                  <video
                    key={current.clipUrl}
                    src={current.clipUrl}
                    autoPlay
                    loop
                    muted={muted}
                    playsInline
                    className="pointer-events-none absolute max-w-none"
                    style={{ left: crop.left, top: crop.top, width: crop.width, height: crop.height, filter: avatarLookFilter(look) }}
                  />
                  {warm && <div aria-hidden className="pointer-events-none absolute inset-0" style={warm} />}
                  <span className="pointer-events-none absolute inset-x-0 bottom-1 mx-auto w-fit rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <Move className="mr-1 inline size-3" /> trascina
                  </span>
                </div>
                {compare && (
                  <span className="absolute left-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-white">Originale</span>
                )}
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setMuted((m) => !m)} aria-pressed={!muted}>
              {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />} {muted ? 'Audio spento' : 'Audio acceso'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onPointerDown={() => setCompare(true)}
              onPointerUp={() => setCompare(false)}
              onPointerLeave={() => setCompare(false)}
              onKeyDown={(e) => e.key === ' ' && setCompare(true)}
              onKeyUp={() => setCompare(false)}
              title="Tieni premuto per vedere l'immagine originale"
            >
              <Eye className="size-4" /> Tieni premuto: originale
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              Slide {current.index} · {Math.round(current.durationSec ?? 0)} s
            </span>
          </div>

          {/* Slide del video: si sceglie quale vedere e regolare. */}
          <div className="flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label="Slide del video">
            {included.map((c) => {
              const t = imp.data?.slides.find((s) => s.index === c.index)?.imageUrl;
              const k = String(c.index);
              const custom = Boolean(
                d.slideShots[k] || d.slidePositions[k] || Object.keys(d.slideLooks[k] ?? {}).length || Object.keys(d.slideFrames[k] ?? {}).length,
              );
              return (
                <button
                  key={c.index}
                  type="button"
                  role="option"
                  aria-selected={c.index === current.index}
                  onClick={() => setSel(c.index)}
                  className={cn(
                    'relative aspect-video w-24 shrink-0 overflow-hidden rounded-md border bg-muted transition',
                    c.index === current.index ? 'ring-2 ring-primary' : 'opacity-75 hover:opacity-100',
                  )}
                >
                  {t ? (
                    // eslint-disable-next-line @next/next/no-img-element -- miniatura
                    <img src={t} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="grid size-full place-items-center text-[10px] text-muted-foreground">Slide {c.index}</span>
                  )}
                  <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[10px] text-white">{c.index}</span>
                  {custom && <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-primary" title="Inquadratura personalizzata" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Comandi */}
        <div className="space-y-4 rounded-xl border bg-card p-4 lg:max-h-[640px] lg:overflow-y-auto">
          <Section title="Disposizione">
            <div className="grid gap-1.5">
              {LAYOUTS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => set({ layout: l.id })}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left transition',
                    d.layout === l.id ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-accent/40',
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {d.layout === l.id && <Check className="size-3.5 text-primary" />} {l.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">{l.hint}</span>
                </button>
              ))}
            </div>
            {d.layout === 'dynamic' && (
              <Field label={`Inquadratura della slide ${current.index}`}>
                <Segmented
                  options={SHOTS.map((s) => ({ id: s.id, label: s.label }))}
                  value={d.slideShots[key] ?? 'auto'}
                  onChange={(v) => {
                    const next = { ...d.slideShots };
                    if (v === 'auto') delete next[key];
                    else next[key] = v as SlideShot;
                    set({ slideShots: next });
                  }}
                />
              </Field>
            )}
            {overlay && (
              <Field label={d.layout === 'pip' ? 'Angolo dell’avatar' : `Angolo nella slide ${current.index}`}>
                <CornerGrid
                  value={d.layout === 'pip' ? d.pipPosition : d.slidePositions[key]}
                  auto={d.layout === 'dynamic' ? (auto?.corner ?? 'bottom-right') : undefined}
                  onChange={(c) => {
                    if (d.layout === 'pip') set({ pipPosition: c ?? d.pipPosition });
                    else {
                      const next = { ...d.slidePositions };
                      if (c) next[key] = c;
                      else delete next[key];
                      set({ slidePositions: next });
                    }
                  }}
                />
              </Field>
            )}
          </Section>

          <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Avatar e immagine: dove applicare</p>
            <Segmented
              options={[
                { id: 'all', label: 'Tutte le slide' },
                { id: 'slide', label: `Solo slide ${current.index}` },
              ]}
              value={scope}
              onChange={(v) => setScope(v as 'all' | 'slide')}
            />
            {scope === 'slide' ? (
              hasOwn ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="font-medium text-primary">La slide {current.index} ha impostazioni proprie.</span>
                  <button type="button" className="underline" onClick={clearOwn}>
                    Torna a quelle generali
                  </button>
                  <button type="button" className="underline" onClick={promoteOwn}>
                    Usale per tutto il video
                  </button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Le modifiche valgono solo per la slide {current.index}; le altre restano come sono.</p>
              )
            ) : (
              <p className="text-xs text-muted-foreground">
                {customCount > 0
                  ? `Vale per tutto il video. ${customCount === 1 ? '1 slide ha' : `${customCount} slide hanno`} impostazioni proprie, che restano.`
                  : 'Le modifiche valgono per tutto il video.'}
              </p>
            )}
          </div>

          <Section title={scope === 'slide' ? `Avatar · slide ${current.index}` : 'Avatar'}>
            <Range
              label="Dimensione"
              value={Math.round(effLook.size * 100)}
              min={60}
              max={160}
              step={5}
              def={100}
              unit="%"
              disabled={!overlay}
              hint={!overlay ? 'Vale per l’avatar in sovrimpressione' : undefined}
              onChange={(v) => setLook({ size: v / 100 })}
            />
            <Field label="Forma">
              <div className="grid grid-cols-3 gap-1.5">
                {(['circle', 'rounded', 'square'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={!overlay}
                    onClick={() => setLook({ shape: s })}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-lg border py-2 text-xs transition disabled:opacity-40',
                      effLook.shape === s ? 'border-primary bg-primary/5' : 'hover:bg-accent/40',
                    )}
                  >
                    <span className={cn('size-6 border-2 border-current', s === 'circle' ? 'rounded-full' : s === 'rounded' ? 'rounded-md' : 'rounded-[2px]')} />
                    {s === 'circle' ? 'Cerchio' : s === 'rounded' ? 'Arrotondato' : 'Quadrato'}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Bordo">
              <Segmented
                options={[
                  { id: 'brand', label: 'Colore brand' },
                  { id: 'white', label: 'Bianco' },
                  { id: 'none', label: 'Nessuno' },
                ]}
                value={effLook.ring}
                onChange={(v) => setLook({ ring: v as AvatarLook['ring'] })}
              />
            </Field>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>Ombra</span>
              <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={effLook.shadow} onChange={(e) => setLook({ shadow: e.target.checked })} />
            </label>
            <Range label="Zoom sul volto" value={Math.round(effFrame.zoom * 100)} min={100} max={250} step={5} def={100} unit="%" onChange={(v) => setFrame({ zoom: v / 100 })} />
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Hand className="size-3.5" /> Trascina l&apos;avatar nell&apos;anteprima per centrare il volto.
              {(effFrame.x !== 50 || effFrame.y !== 22) && (
                <button type="button" className="ml-auto underline" onClick={() => setFrame({ x: 50, y: 22 })}>
                  Centra
                </button>
              )}
            </p>
          </Section>

          <Section
            title={scope === 'slide' ? `Immagine · slide ${current.index}` : 'Immagine'}
            action={
              <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setLook(PRESETS[0]!.look)}>
                Ripristina
              </button>
            }
          >
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setLook(p.look)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition',
                    sameLook(effLook, p.look) ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent/40',
                  )}
                >
                  {p.id === 'auto' && <Wand2 className="size-3" />}
                  {p.label}
                </button>
              ))}
            </div>
            <Range label="Luminosità" icon={<SunMedium className="size-3.5" />} value={effLook.brightness} min={-50} max={50} step={1} def={0} signed onChange={(v) => setLook({ brightness: v })} />
            <Range label="Contrasto" value={effLook.contrast} min={-50} max={50} step={1} def={0} signed onChange={(v) => setLook({ contrast: v })} />
            <Range label="Saturazione" value={effLook.saturation} min={-100} max={100} step={1} def={0} signed onChange={(v) => setLook({ saturation: v })} />
            <Range
              label="Temperatura"
              value={effLook.warmth}
              min={-50}
              max={50}
              step={1}
              def={0}
              signed
              track="linear-gradient(90deg,#60a5fa,#e5e7eb,#fb923c)"
              onChange={(v) => setLook({ warmth: v })}
            />
            <p className="text-[11px] text-muted-foreground">
              Corregge luce e colori del video dell&apos;avatar. Non recupera un video sfocato o rumoroso.
            </p>
          </Section>
        </div>
      </div>

      {/* Barra di applicazione */}
      <div
        className={cn(
          'sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 shadow-sm backdrop-blur',
          dirty ? 'border-primary/40 bg-primary/5' : 'bg-background/90',
        )}
      >
        <p className="flex items-center gap-2 text-sm">
          {running ? (
            <>
              <Loader2 className="size-4 animate-spin text-primary" /> Rimontaggio in corso: il video si aggiorna da solo.
            </>
          ) : dirty ? (
            <>
              <Sparkles className="size-4 text-primary" /> Modifiche visibili nell&apos;anteprima, non ancora nel video.
            </>
          ) : (
            <span className="text-muted-foreground">Il video corrisponde alla regia attuale.</span>
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDraft(saved)} disabled={!dirty || remaster.isPending}>
            <Undo2 className="size-4" /> Annulla modifiche
          </Button>
          <Button size="sm" onClick={() => void apply()} disabled={!dirty || running || remaster.isPending}>
            {remaster.isPending ? <Loader2 className="size-4 animate-spin" /> : <Clapperboard className="size-4" />} Applica al video
            <CreditCost items={[{ feature: 'video_render', units: totalMin }]} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b pb-4 last:border-0 last:pb-0">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">{label}</p>
      {children}
    </div>
  );
}

function Segmented({ options, value, onChange }: { options: Array<{ id: string; label: string }>; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg bg-muted/50 p-1" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'flex-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium transition',
            value === o.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CornerGrid({ value, auto, onChange }: { value?: PipPosition; auto?: PipPosition; onChange: (c: PipPosition | undefined) => void }) {
  const shown = value ?? auto;
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-16 w-28 rounded-md border bg-muted/40">
        {CORNERS.map((c) => {
          const [v, h] = c.id.split('-') as ['top' | 'bottom', 'left' | 'right'];
          return (
            <button
              key={c.id}
              type="button"
              title={c.label}
              aria-label={c.label}
              aria-pressed={shown === c.id}
              onClick={() => onChange(c.id)}
              className={cn(
                'absolute size-5 rounded-full border-2 transition',
                v === 'top' ? 'top-1' : 'bottom-1',
                h === 'left' ? 'left-1' : 'right-1',
                shown === c.id ? (value ? 'border-primary bg-primary' : 'border-primary/60 bg-primary/30') : 'border-muted-foreground/40 hover:border-primary',
              )}
            />
          );
        })}
      </div>
      {auto && (
        <button type="button" className={cn('text-xs underline', !value && 'text-muted-foreground')} onClick={() => onChange(undefined)} disabled={!value}>
          {value ? 'Torna automatico' : 'Automatico'}
        </button>
      )}
    </div>
  );
}

function Range(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  def: number;
  unit?: string;
  signed?: boolean;
  disabled?: boolean;
  hint?: string;
  icon?: React.ReactNode;
  track?: string;
  onChange: (v: number) => void;
}) {
  const changed = props.value !== props.def;
  const shown = `${props.signed && props.value > 0 ? '+' : ''}${props.value}${props.unit ?? ''}`;
  return (
    <div className={cn('space-y-1', props.disabled && 'opacity-50')}>
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 font-medium">
          {props.icon} {props.label}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn('tabular-nums', changed ? 'text-foreground' : 'text-muted-foreground')}>{shown}</span>
          {changed && !props.disabled && (
            <button type="button" onClick={() => props.onChange(props.def)} aria-label={`Ripristina ${props.label}`} className="text-muted-foreground hover:text-foreground">
              <RotateCcw className="size-3" />
            </button>
          )}
        </span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
        onDoubleClick={() => props.onChange(props.def)}
        aria-label={props.label}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full accent-[hsl(var(--primary))]"
        style={{ background: props.track ?? 'hsl(var(--muted))' }}
      />
      {props.hint && <p className="text-[11px] text-muted-foreground">{props.hint}</p>}
    </div>
  );
}

function hexA(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(245,183,0,${a})`;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1]!, 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
