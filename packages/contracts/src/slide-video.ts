import { z } from 'zod';

/**
 * SlideVideoSpec — descrizione di un video-lezione "slide + avatar": una
 * sequenza di slide (immagini) ciascuna accompagnata da una clip dell'avatar che
 * la racconta. Condiviso tra l'API (che assembla clip, durate e trascrizione) e
 * il motore Remotion (che monta il video): la matematica della timeline vive qui
 * una volta sola, così trascrizione e video restano allineati per costruzione.
 *
 * Il timing è guidato dalla DURATA REALE di ogni clip avatar: ogni slide resta a
 * schermo esattamente quanto dura la sua clip, quindi il cambio slide è
 * sincronizzato con la voce senza stime.
 */

/** Disposizione del video: slide affiancata all'avatar, oppure avatar in cerchio sopra la slide. */
export const SlideVideoLayout = z.enum(['split', 'pip', 'dynamic']);
export type SlideVideoLayout = z.infer<typeof SlideVideoLayout>;

/** Posizione del cerchio avatar nel layout "pip". */
export const PipPosition = z.enum(['bottom-right', 'bottom-left', 'top-right', 'top-left']);
export type PipPosition = z.infer<typeof PipPosition>;

/**
 * Inquadratura di una slide nel layout "dynamic" (regia):
 *  - presenter: avatar grande, slide in una card più piccola (apertura, sezioni, chiusura);
 *  - side: slide grande con l'avatar in un riquadro affiancato (slide con poco testo);
 *  - focus: slide a tutto schermo, avatar in un cerchio in un angolo (slide dense);
 *  - mini: slide a tutto schermo, avatar in un cerchio piccolo e discreto (slide molto dense).
 * Il passaggio tra un'inquadratura e la successiva è animato.
 */
export const SlideShot = z.enum(['presenter', 'side', 'focus', 'mini']);
export type SlideShot = z.infer<typeof SlideShot>;

/** Inquadrature per slide (chiave = indice della slide nell'import) che sostituiscono quelle automatiche. */
export const SlideShots = z.record(z.string().regex(/^\d+$/), SlideShot);
export type SlideShots = z.infer<typeof SlideShots>;

/**
 * Inquadratura della persona dentro il riquadro/cerchio dell'avatar: punto da tenere al centro
 * (percentuali della clip) e zoom. Serve quando la persona non è al centro della clip.
 */
export const AvatarFrame = z.object({
  x: z.number().min(0).max(100).default(50),
  y: z.number().min(0).max(100).default(22),
  zoom: z.number().min(1).max(2.5).default(1),
});
export type AvatarFrame = z.infer<typeof AvatarFrame>;
/**
 * Resa dell'avatar nel montaggio: dimensione e forma del riquadro in sovrimpressione, bordo,
 * ombra e correzione dell'immagine. Si applica solo al montaggio (nessuna clip da rigenerare).
 * Le correzioni sono scostamenti dal video originale: 0 = invariato.
 */
export const AvatarLook = z.object({
  /** Dimensione del riquadro in sovrimpressione (1 = standard). */
  size: z.number().min(0.6).max(1.6).default(1),
  shape: z.enum(['circle', 'rounded', 'square']).default('circle'),
  ring: z.enum(['brand', 'white', 'none']).default('brand'),
  shadow: z.boolean().default(true),
  /** Da -50 a +50: scostamento percentuale. */
  brightness: z.number().min(-50).max(50).default(0),
  contrast: z.number().min(-50).max(50).default(0),
  /** Da -100 (bianco e nero) a +100. */
  saturation: z.number().min(-100).max(100).default(0),
  /** Da -50 (più freddo) a +50 (più caldo). */
  warmth: z.number().min(-50).max(50).default(0),
});
export type AvatarLook = z.infer<typeof AvatarLook>;

/** Resa dell'avatar completa (valori di default per i campi mancanti). */
export function resolveAvatarLook(look?: Partial<AvatarLook> | null): AvatarLook {
  return AvatarLook.parse(look ?? {});
}

/** Filtro CSS della correzione dell'immagine: identico nel montaggio e nell'anteprima. */
export function avatarLookFilter(look?: Partial<AvatarLook> | null): string | undefined {
  const l = resolveAvatarLook(look);
  const parts: string[] = [];
  if (l.brightness) parts.push(`brightness(${(1 + l.brightness / 100).toFixed(3)})`);
  if (l.contrast) parts.push(`contrast(${(1 + l.contrast / 100).toFixed(3)})`);
  if (l.saturation) parts.push(`saturate(${(1 + l.saturation / 100).toFixed(3)})`);
  return parts.length ? parts.join(' ') : undefined;
}

/** Velo di colore per il calore (fusione "soft-light" sopra il video), o null se neutro. */
export function avatarWarmthOverlay(look?: Partial<AvatarLook> | null): { background: string; mixBlendMode: 'soft-light' } | null {
  const w = resolveAvatarLook(look).warmth;
  if (!w) return null;
  const a = Math.min(0.6, Math.abs(w) / 100 + 0.05);
  return { background: w > 0 ? `rgba(255,140,40,${a.toFixed(3)})` : `rgba(40,130,255,${a.toFixed(3)})`, mixBlendMode: 'soft-light' };
}

/** Raggio degli angoli del riquadro in sovrimpressione, secondo la forma scelta. */
export function avatarOverlayRadius(shape: AvatarLook['shape'], side: number): number {
  return shape === 'circle' ? side / 2 : shape === 'rounded' ? side * 0.16 : side * 0.03;
}

/** Riquadro in coordinate del canvas 1920x1080. */
export interface StageRect {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

/** Geometria di un'inquadratura del layout "dynamic" sul canvas 1920x1080 (condivisa con l'anteprima). */
export interface DynamicShotGeometry {
  slide: StageRect;
  avatar: StageRect & { zoom: number; ring: number; shadow: number };
  backdrop: number;
  full: number;
}

const STAGE_W = 1920;
const STAGE_H = 1080;

function overlayAt(corner: PipPosition, d: number, m: number, shape: AvatarLook['shape']): StageRect {
  return {
    x: corner.endsWith('right') ? STAGE_W - m - d : m,
    y: corner.startsWith('bottom') ? STAGE_H - m - d : m,
    w: d,
    h: d,
    r: avatarOverlayRadius(shape, d),
  };
}

/**
 * Geometria di riferimento di ogni inquadratura del layout dinamico. La dimensione e la forma
 * della resa valgono per l'avatar in sovrimpressione (inquadrature "focus" e "mini").
 */
export function dynamicShotGeometry(shot: SlideShot, corner: PipPosition, look?: Partial<AvatarLook> | null): DynamicShotGeometry {
  const l = resolveAvatarLook(look);
  const ring = l.ring === 'none' ? 0 : 1;
  const shadow = l.shadow ? 1 : 0;
  switch (shot) {
    case 'presenter':
      return {
        slide: { x: 96, y: 238, w: 1040, h: 585, r: 22 },
        avatar: { x: 1196, y: 110, w: 628, h: 860, r: 32, zoom: 1, ring: 0, shadow },
        backdrop: 1,
        full: 0,
      };
    case 'side':
      return {
        slide: { x: 64, y: 180, w: 1280, h: 720, r: 20 },
        avatar: { x: 1376, y: 180, w: 480, h: 720, r: 26, zoom: 1.04, ring: 0, shadow },
        backdrop: 0.6,
        full: 0,
      };
    case 'mini':
      return {
        slide: { x: 0, y: 0, w: STAGE_W, h: STAGE_H, r: 0 },
        avatar: { ...overlayAt(corner, Math.round(200 * l.size), 34, l.shape), zoom: 1.42, ring: 5 * ring, shadow: 0.8 * shadow },
        backdrop: 0,
        full: 1,
      };
    case 'focus':
    default:
      return {
        slide: { x: 0, y: 0, w: STAGE_W, h: STAGE_H, r: 0 },
        avatar: { ...overlayAt(corner, Math.round(300 * l.size), 44, l.shape), zoom: 1.32, ring: 6 * ring, shadow: 0.9 * shadow },
        backdrop: 0,
        full: 1,
      };
  }
}

/** Modifiche di resa per singola slide (chiave = indice della slide nell'import). */
export const SlideAvatarLooks = z.record(z.string().regex(/^\d+$/), AvatarLook.partial());
export type SlideAvatarLooks = z.infer<typeof SlideAvatarLooks>;
/** Inquadratura del volto per singola slide (chiave = indice della slide nell'import). */
export const SlideAvatarFrames = z.record(z.string().regex(/^\d+$/), AvatarFrame.partial());
export type SlideAvatarFrames = z.infer<typeof SlideAvatarFrames>;

/** Resa effettiva dell'avatar in una slide: quella del video con le modifiche della slide. */
export function slideAvatarLook(
  general: Partial<AvatarLook> | null | undefined,
  override: Partial<AvatarLook> | null | undefined,
): AvatarLook {
  return resolveAvatarLook({ ...(general ?? {}), ...(override ?? {}) });
}

/** Inquadratura effettiva del volto in una slide. */
export function slideAvatarFrame(
  general: Partial<AvatarFrame> | null | undefined,
  override: Partial<AvatarFrame> | null | undefined,
): { x: number; y: number; zoom: number } {
  const f = { ...(general ?? {}), ...(override ?? {}) };
  return { x: f.x ?? 50, y: f.y ?? 22, zoom: f.zoom ?? 1 };
}

/** Colore del bordo dell'avatar secondo la resa (accento del brand, bianco o nessuno). */
export function avatarRingColor(look: Partial<AvatarLook> | null | undefined, accent: string): string {
  const r = resolveAvatarLook(look).ring;
  return r === 'white' ? '#ffffff' : r === 'none' ? 'transparent' : accent;
}


/** Posizioni per slide (chiave = indice della slide nell'import, 1-based) che sostituiscono il default. */
export const SlidePipPositions = z.record(z.string().regex(/^\d+$/), PipPosition);
export type SlidePipPositions = z.infer<typeof SlidePipPositions>;

/** Riga di sottotitolo, con tempi in secondi RELATIVI all'inizio della clip della slide. */
export const SlideCue = z.object({
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  text: z.string(),
});
export type SlideCue = z.infer<typeof SlideCue>;

export const SlideVideoSlide = z.object({
  id: z.string().min(1),
  /** URL (firmato) dell'immagine della slide. Assente per le slide "extra" create dal testo. */
  imageUrl: z.string().min(1).optional(),
  /** Slide testuale (titolo + punti) disegnata dal renderer quando non c'è un'immagine. */
  textSlide: z
    .object({ title: z.string().min(1), bullets: z.array(z.string()).default([]) })
    .optional(),
  /** URL (firmato) della clip avatar che narra la slide. */
  clipUrl: z.string().min(1),
  /** Durata reale della clip in secondi. */
  durationSec: z.number().positive(),
  /** Titolo breve della slide (opzionale, per accessibilità/indice). */
  title: z.string().optional(),
  /** Testo narrato: usato come unica cue se la clip non ha sottotitoli propri. */
  narration: z.string().optional(),
  /** Sottotitoli della clip (da SRT HeyGen), tempi relativi alla clip. */
  cues: z.array(SlideCue).default([]),
  /** Posizione dell'avatar per questa slide (layout pip); se assente vale quella del video. */
  pipPosition: PipPosition.optional(),
  /** Inquadratura della slide nel layout dynamic (default: focus). */
  shot: SlideShot.optional(),
  /** Video al posto dell'immagine (crea da video): muto, dal secondo `startSec` per `durationSec`. */
  video: z
    .object({ url: z.string().min(1), startSec: z.number().nonnegative().default(0), durationSec: z.number().positive() })
    .optional(),
  /** Resa e inquadratura dell'avatar solo per questa slide: si sommano a quelle del video. */
  avatarLook: AvatarLook.partial().optional(),
  avatarFrame: AvatarFrame.partial().optional(),
});
export type SlideVideoSlide = z.infer<typeof SlideVideoSlide>;

export const SlideVideoTheme = z.object({
  bg: z.string().default('#0b0f14'),
  accent: z.string().default('#f5b700'),
  text: z.string().default('#ffffff'),
});
export type SlideVideoTheme = z.infer<typeof SlideVideoTheme>;

/**
 * Sfondo di una scheda di copertina o finale: una slide (immagine) oppure un fotogramma fermo di
 * una clip avatar (`atSec` secondi dall'inizio della clip). Gli URL sono già risolti e firmati.
 */
export const SlideVideoCardBackground = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('slide'), imageUrl: z.string().min(1) }),
  z.object({ kind: z.literal('frame'), clipUrl: z.string().min(1), atSec: z.number().nonnegative() }),
]);
export type SlideVideoCardBackground = z.infer<typeof SlideVideoCardBackground>;

/** Copertina o schermata finale del video: titolo, sottotitolo, logo e sfondo opzionali. */
export const SlideVideoCard = z.object({
  title: z.string().max(200).default(''),
  subtitle: z.string().max(300).optional(),
  durationSec: z.number().min(1).max(12).default(4),
  /** URL (firmato) del logo del brand, mostrato sopra il titolo. */
  logoUrl: z.string().min(1).optional(),
  background: SlideVideoCardBackground.optional(),
});
export type SlideVideoCard = z.infer<typeof SlideVideoCard>;

export const SlideVideoSpec = z.object({
  version: z.literal(1).default(1),
  canvas: z
    .object({
      width: z.number().int().positive().default(1920),
      height: z.number().int().positive().default(1080),
      fps: z.number().int().positive().max(60).default(30),
    })
    .default({}),
  layout: SlideVideoLayout.default('split'),
  /** Posizione di default del cerchio avatar nel layout pip (vale per tutte le slide). */
  pipPosition: PipPosition.default('bottom-right'),
  /**
   * Sottotitoli incisi nel video. Default false: nella lezione c'è la trascrizione a fianco e
   * una traccia CC attivabile dal player; incisi servono solo se l'MP4 si usa fuori dal corso.
   */
  burnCaptions: z.boolean().default(false),
  /** Inquadratura della persona nella clip (vale per tutte le slide). */
  avatarFrame: AvatarFrame.default({}),
  /** Resa dell'avatar: dimensione, forma, bordo, ombra e correzione dell'immagine. */
  avatarLook: AvatarLook.default({}),
  theme: SlideVideoTheme.default({}),
  /** Titolo del modulo/sezione, mostrato nel pannello laterale. */
  sectionTitle: z.string().optional(),
  /** Copertina prima delle slide e schermata finale dopo: la timeline delle slide non cambia. */
  cover: SlideVideoCard.optional(),
  outro: SlideVideoCard.optional(),
  slides: z.array(SlideVideoSlide).min(1),
});
export type SlideVideoSpec = z.infer<typeof SlideVideoSpec>;

/** Frame di copertina, corpo (slide) e schermata finale del video completo. */
export interface SlideVideoSegments {
  coverFrames: number;
  bodyFrames: number;
  outroFrames: number;
  totalFrames: number;
  /** Secondi di ritardo con cui iniziano le slide (durata della copertina). */
  offsetSec: number;
  totalSec: number;
}

export function slideVideoSegments(
  spec: Pick<SlideVideoSpec, 'cover' | 'outro' | 'slides'>,
  fps: number,
): SlideVideoSegments {
  const body = computeSlideTimeline(spec.slides, fps);
  const coverFrames = spec.cover ? Math.max(1, Math.round(spec.cover.durationSec * fps)) : 0;
  const outroFrames = spec.outro ? Math.max(1, Math.round(spec.outro.durationSec * fps)) : 0;
  const totalFrames = coverFrames + body.totalFrames + outroFrames;
  return {
    coverFrames,
    bodyFrames: body.totalFrames,
    outroFrames,
    totalFrames,
    offsetSec: coverFrames / fps,
    totalSec: totalFrames / fps,
  };
}

/** Posizione di una slide sulla timeline del video finale. */
export interface SlideTimelineEntry {
  index: number;
  /** Frame di inizio (assoluto). */
  startFrame: number;
  /** Durata in frame (>= 1). */
  durationFrames: number;
  /** Secondi di inizio (assoluto). */
  startSec: number;
  /** Secondi di fine (assoluto). */
  endSec: number;
}

export interface SlideTimeline {
  entries: SlideTimelineEntry[];
  totalFrames: number;
  totalSec: number;
}

/**
 * Calcola la timeline concatenando le slide in sequenza. Gli estremi in frame
 * si ottengono arrotondando i secondi CUMULATIVI (non le singole durate), così
 * l'errore di arrotondamento non si accumula lungo decine di slide e la durata
 * totale resta fedele alla somma delle clip.
 */
export function computeSlideTimeline(
  slides: Array<{ durationSec: number }>,
  fps: number,
): SlideTimeline {
  const entries: SlideTimelineEntry[] = [];
  let cursorSec = 0;
  let prevEndFrame = 0;
  slides.forEach((s, index) => {
    const startSec = cursorSec;
    const endSec = cursorSec + s.durationSec;
    const startFrame = prevEndFrame;
    const endFrame = Math.max(startFrame + 1, Math.round(endSec * fps));
    entries.push({ index, startFrame, durationFrames: endFrame - startFrame, startSec, endSec });
    cursorSec = endSec;
    prevEndFrame = endFrame;
  });
  return { entries, totalFrames: prevEndFrame, totalSec: cursorSec };
}

/** Cue con tempi GLOBALI (secondi dall'inizio del video), per trascrizione e sottotitoli. */
export interface GlobalCue {
  id: string;
  start: number;
  end: number;
  text: string;
  /** Indice della slide a cui appartiene. */
  slideIndex: number;
}

/**
 * Converte le cue di ogni slide (relative alla clip) in cue globali sommando
 * l'offset di inizio della slide. Le cue vengono tagliate alla finestra della
 * propria slide, così un sottotitolo non invade mai la slide successiva. Se una
 * slide non ha cue ma ha `narration`, genera un'unica cue sull'intera durata.
 */
export function globalCues(
  slides: Array<Pick<SlideVideoSlide, 'durationSec' | 'cues' | 'narration'>>,
  timeline: SlideTimeline,
): GlobalCue[] {
  const out: GlobalCue[] = [];
  slides.forEach((s, i) => {
    const entry = timeline.entries[i];
    if (!entry) return;
    const windowStart = entry.startSec;
    const windowEnd = entry.endSec;
    const cues = s.cues && s.cues.length > 0
      ? s.cues
      : s.narration && s.narration.trim()
        ? [{ start: 0, end: s.durationSec, text: s.narration.trim() }]
        : [];
    cues.forEach((c) => {
      const start = Math.min(windowEnd, windowStart + Math.max(0, c.start));
      const rawEnd = windowStart + (c.end > c.start ? c.end : s.durationSec);
      const end = Math.min(windowEnd, Math.max(start, rawEnd));
      if (!c.text.trim()) return;
      out.push({ id: `cue-${out.length}`, start, end, text: c.text.trim(), slideIndex: i });
    });
  });
  return out;
}

/**
 * Cue attiva al tempo `tSec` (globale): l'ultima il cui start è <= t e il cui
 * end è > t. Ritorna null nei vuoti tra una cue e l'altra.
 */
export function activeCueAt(cues: GlobalCue[], tSec: number): GlobalCue | null {
  let found: GlobalCue | null = null;
  for (const c of cues) {
    if (c.start <= tSec && tSec < c.end) found = c;
    if (c.start > tSec) break;
  }
  return found;
}


/* ------------------------------ Crea da video ------------------------------ */

/**
 * Taratura dei copioni sui video: ritmo di parlato di partenza (poi si usa quello misurato sulle
 * clip già generate), quanto può riempire il copione e la tolleranza con cui il montaggio adatta
 * la velocità del video alla voce senza che si noti.
 */
export const VIDEO_SCRIPT = {
  wordsPerSec: 2.4,
  /** Il copione ideale occupa il 90% del video: resta un attimo di respiro alla fine. */
  targetRatio: 0.9,
  maxRatio: 1.0,
  minRatio: 0.65,
  /** Entro ±10% il video rallenta o accelera per finire con la voce; oltre si ferma o si taglia. */
  speedTolerance: 0.1,
  maxVideoBytes: 150 * 1024 * 1024,
  maxVideos: 40,
} as const;

/** Da dove nasce il copione di un video: scritto dall'utente, da una sua indicazione, o guardando il video. */
export const VideoScriptSource = z.enum(['manual', 'hint', 'frames']);
export type VideoScriptSource = z.infer<typeof VideoScriptSource>;

/** Parole consentite per un video di `durationSec` secondi al ritmo `wordsPerSec`. */
export function videoWordBudget(durationSec: number, wordsPerSec: number = VIDEO_SCRIPT.wordsPerSec): { min: number; target: number; max: number } {
  const w = Math.max(0, durationSec) * wordsPerSec;
  return {
    min: Math.max(1, Math.floor(w * VIDEO_SCRIPT.minRatio)),
    target: Math.max(1, Math.round(w * VIDEO_SCRIPT.targetRatio)),
    max: Math.max(1, Math.floor(w * VIDEO_SCRIPT.maxRatio)),
  };
}

/** Esito della taratura di un copione rispetto al suo video. */
export function videoScriptFit(
  words: number,
  durationSec: number,
  wordsPerSec: number = VIDEO_SCRIPT.wordsPerSec,
): { status: 'empty' | 'short' | 'ok' | 'long'; estSec: number; budget: ReturnType<typeof videoWordBudget> } {
  const budget = videoWordBudget(durationSec, wordsPerSec);
  const estSec = Math.round((words / wordsPerSec) * 10) / 10;
  const status = words === 0 ? 'empty' : words > budget.max ? 'long' : words < budget.min ? 'short' : 'ok';
  return { status, estSec, budget };
}

/**
 * Come il montaggio fa combaciare video e voce: entro la tolleranza cambia leggermente la velocità
 * del video; se il video è più corto si ferma sull'ultimo fotogramma, se è più lungo si taglia.
 */
export function videoTiming(videoSec: number, voiceSec: number): { rate: number; mode: 'match' | 'speed' | 'freeze' | 'cut' } {
  if (videoSec <= 0 || voiceSec <= 0) return { rate: 1, mode: 'match' };
  const ratio = videoSec / voiceSec;
  if (Math.abs(ratio - 1) < 0.01) return { rate: 1, mode: 'match' };
  if (Math.abs(ratio - 1) <= VIDEO_SCRIPT.speedTolerance) return { rate: Math.round(ratio * 1000) / 1000, mode: 'speed' };
  return { rate: 1, mode: ratio < 1 ? 'freeze' : 'cut' };
}

/** Ordine, tratto e fonte del copione dei video di un import (prima di generare i copioni). */
export const UpdateVideoImport = z.object({
  videos: z
    .array(
      z.object({
        index: z.number().int().positive(),
        mode: VideoScriptSource.default('frames'),
        hint: z.string().trim().max(1000).optional(),
        script: z.string().max(4000).optional(),
        trim: z.object({ start: z.number().nonnegative(), end: z.number().positive() }).optional(),
      }),
    )
    .min(1)
    .max(VIDEO_SCRIPT.maxVideos),
});
export type UpdateVideoImport = z.infer<typeof UpdateVideoImport>;

/** Copione di una slide (testo che l'avatar pronuncerà). `skip` esclude la slide dal video. */
export const SlideScriptItem = z.object({
  index: z.number().int().positive(),
  script: z.string().max(4000),
  skip: z.boolean().default(false),
});
export type SlideScriptItem = z.infer<typeof SlideScriptItem>;

/** Aggiornamento dei copioni da parte del revisore. `approved` = via libera alla generazione clip. */
export const UpdateSlideScripts = z.object({
  slides: z.array(SlideScriptItem).min(1).max(200),
  approved: z.boolean().default(false),
});

/**
 * Glossario di pronuncia: `term` come compare nel testo, `spoken` come lo deve leggere la voce
 * (scrittura fonetica). Vale solo per l'audio: slide, trascrizione e sottotitoli restano con `term`.
 */
export const PronunciationEntry = z.object({
  term: z.string().trim().min(1).max(80),
  spoken: z.string().trim().min(1).max(120),
});
export type PronunciationEntry = z.infer<typeof PronunciationEntry>;
export const UpdateSlideGlossary = z.object({ glossary: z.array(PronunciationEntry).max(50) });
export type UpdateSlideGlossary = z.infer<typeof UpdateSlideGlossary>;
export type UpdateSlideScripts = z.infer<typeof UpdateSlideScripts>;

/** Avvio della generazione delle clip avatar (una per slide). */
export const StartSlideClips = z.object({
  /** Id del LOOK HeyGen (non del gruppo). */
  avatarId: z.string().min(1),
  /** Tipo di avatar per la tariffa: il digital twin costa diversamente da photo/studio. */
  avatarType: z.enum(['photo', 'studio', 'digital_twin']).default('digital_twin'),
  /** Voce TTS; se assente HeyGen usa quella dell'avatar. */
  voiceId: z.string().min(1).optional(),
  /** Engine di rendering; se assente il default del server (il più economico). */
  engine: z.enum(['avatar_iii', 'avatar_iv', 'avatar_v']).optional(),
  resolution: z.enum(['720p', '1080p']).optional(),
});
export type StartSlideClips = z.infer<typeof StartSlideClips>;

/**
 * Scheda di copertina o finale richiesta dall'utente. Lo sfondo è una slide dell'import oppure un
 * fotogramma di una clip avatar (`atSec` dall'inizio della clip della slide `index`).
 */
export const SlideCardInput = z.object({
  title: z.string().trim().max(200).optional(),
  subtitle: z.string().trim().max(300).optional(),
  background: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('slide'), index: z.number().int().positive() }),
      z.object({ kind: z.literal('frame'), index: z.number().int().positive(), atSec: z.number().nonnegative() }),
    ])
    .optional(),
});
export type SlideCardInput = z.infer<typeof SlideCardInput>;

/** Montaggio del video finale e creazione della lezione. */
export const BuildSlideLesson = z.object({
  layout: SlideVideoLayout.default('dynamic'),
  /** Titolo del modulo e della lezione creati (o del corso, con più sezioni). */
  moduleTitle: z.string().trim().min(1).max(200).optional(),
  /**
   * Se presente, crea UN MODULO PER SEZIONE (video, riepilogo e quiz per ciascuna, più un
   * quiz finale). `from` è la prima slide della sezione; la prima parte da 1.
   */
  sections: z
    .array(z.object({ title: z.string().trim().min(1).max(200), from: z.number().int().min(1) }))
    .min(1)
    .max(12)
    .optional(),
  pipPosition: PipPosition.default('bottom-right'),
  slidePositions: SlidePipPositions.default({}),
  slideShots: SlideShots.default({}),
  burnCaptions: z.boolean().default(false),
  avatarFrame: AvatarFrame.optional(),
  avatarLook: AvatarLook.optional(),
  slideLooks: SlideAvatarLooks.optional(),
  slideFrames: SlideAvatarFrames.optional(),
  cover: SlideCardInput.optional(),
  outro: SlideCardInput.optional(),
  /** Brand per colori e logo (solo libreria: nei corsi vale il brand principale del corso). */
  brandId: z.string().min(1).optional(),
});

/** Rimontaggio dei video con le slide attuali; consente di cambiare disposizione e posizioni. */
export const RemasterSlideLesson = z.object({
  layout: SlideVideoLayout.optional(),
  pipPosition: PipPosition.optional(),
  slidePositions: SlidePipPositions.optional(),
  slideShots: SlideShots.optional(),
  burnCaptions: z.boolean().optional(),
  avatarFrame: AvatarFrame.optional(),
  avatarLook: AvatarLook.optional(),
  slideLooks: SlideAvatarLooks.optional(),
  slideFrames: SlideAvatarFrames.optional(),
  /** `null` toglie la scheda; assente lascia quella attuale. */
  cover: SlideCardInput.nullable().optional(),
  outro: SlideCardInput.nullable().optional(),
  brandId: z.string().min(1).nullable().optional(),
});
export type RemasterSlideLesson = z.infer<typeof RemasterSlideLesson>;
export type BuildSlideLesson = z.infer<typeof BuildSlideLesson>;

/** Generazione dei copioni, opzionalmente arricchiti da documenti di knowledge. */
export const GenerateSlideScripts = z.object({
  /** Documenti di knowledge (pronti) con cui confrontare e arricchire le slide. */
  knowledgeDocIds: z.array(z.string().min(1)).max(10).default([]),
});
export type GenerateSlideScripts = z.infer<typeof GenerateSlideScripts>;

/**
 * Ritaglio della clip avatar in un riquadro: porta il punto (x%, y%) della clip AL CENTRO del
 * riquadro, con l'ingrandimento richiesto, senza mai lasciare bordi vuoti (il punto si avvicina
 * al centro quanto consentito dai bordi della clip). Restituisce posizione e dimensioni del
 * video dentro il riquadro, in px. La stessa funzione serve al montaggio e all'anteprima.
 */
export function avatarCrop(
  boxW: number,
  boxH: number,
  frame: { x?: number; y?: number; zoom?: number } | undefined,
  baseZoom = 1,
  clipAspect = 16 / 9,
): { left: number; top: number; width: number; height: number } {
  const x = (frame?.x ?? 50) / 100;
  const y = (frame?.y ?? 22) / 100;
  const zoom = Math.max(1, baseZoom * (frame?.zoom ?? 1));
  const cover = Math.max(boxW / clipAspect, boxH); // altezza minima della clip per coprire il riquadro
  const height = cover * zoom;
  const width = height * clipAspect;
  const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
  const left = clamp(boxW / 2 - x * width, boxW - width, 0);
  const top = clamp(boxH * 0.42 - y * height, boxH - height, 0);
  return { left, top, width, height };
}
