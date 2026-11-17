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
});
export type SlideVideoSlide = z.infer<typeof SlideVideoSlide>;

export const SlideVideoTheme = z.object({
  bg: z.string().default('#0b0f14'),
  accent: z.string().default('#f5b700'),
  text: z.string().default('#ffffff'),
});
export type SlideVideoTheme = z.infer<typeof SlideVideoTheme>;

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
  theme: SlideVideoTheme.default({}),
  /** Titolo del modulo/sezione, mostrato nel pannello laterale. */
  sectionTitle: z.string().optional(),
  slides: z.array(SlideVideoSlide).min(1),
});
export type SlideVideoSpec = z.infer<typeof SlideVideoSpec>;

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
});

/** Rimontaggio dei video con le slide attuali; consente di cambiare disposizione e posizioni. */
export const RemasterSlideLesson = z.object({
  layout: SlideVideoLayout.optional(),
  pipPosition: PipPosition.optional(),
  slidePositions: SlidePipPositions.optional(),
  slideShots: SlideShots.optional(),
  burnCaptions: z.boolean().optional(),
  avatarFrame: AvatarFrame.optional(),
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
