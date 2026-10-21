import { z } from 'zod';

/**
 * VideoSpec — sceneggiatura strutturata per i cartoon "code-to-video" delle
 * pillole. Generata dall'LLM, validata qui, consumata dal motore Remotion.
 *
 * Principio: il timing è LOGICO, non in frame/secondi. Gli eventi (entrata/
 * uscita dei layer) sono ancorati alle PAROLE del voiceover; i frame reali si
 * calcolano a valle dai word-timings del TTS (vedi video-spec-timing.ts). Così
 * il sync voce↔grafica è esatto e l'LLM non deve indovinare le durate.
 *
 * La lista `ComponentName` è la WHITELIST condivisa: l'LLM può comporre solo
 * questi componenti (che esistono davvero nel registry Remotion); nessun codice
 * arbitrario. È fonte di verità sia per la validazione sia per il prompt.
 */

/** Timestamp di una parola del voiceover (dagli speech marks del TTS). */
export interface WordMark {
  /** Testo della parola. */
  word: string;
  /** Inizio della parola in millisecondi dall'avvio dell'audio. */
  startMs: number;
  /** Fine della parola in millisecondi (start della parola dopo o fine audio). */
  endMs: number;
}

/**
 * Ancora temporale di un evento: indice di PAROLA del voiceover, oppure gli
 * estremi logici della scena. Convertita in frame dal renderer.
 */
export const Anchor = z.union([
  z.object({ word: z.number().int().nonnegative() }),
  z.literal('sceneStart'),
  z.literal('sceneEnd'),
]);
export type Anchor = z.infer<typeof Anchor>;

/** Tipi di animazione di entrata/uscita supportati dai layer. */
export const AnimKind = z.enum(['fadeUp', 'fadeOut', 'popIn', 'slideIn', 'none']);
export type AnimKind = z.infer<typeof AnimKind>;

/** Specifica di un'animazione: quando parte, che tipo, quanto dura. */
export const AnimSpec = z.object({
  at: Anchor,
  anim: AnimKind.default('fadeUp'),
  ms: z.number().int().positive().max(5000).default(400),
});
export type AnimSpec = z.infer<typeof AnimSpec>;

/**
 * WHITELIST dei componenti Remotion componibili dall'LLM. Deve restare allineata
 * al registry in packages/video (ogni nome qui ha un componente lì).
 */
export const ComponentName = z.enum([
  'TextReveal',
  'Caption',
  'BulletList',
  'ChainDiagram',
  'IconStat',
  'ArrowFlow',
  'LowerThird',
]);
export type ComponentName = z.infer<typeof ComponentName>;

/** Un layer (elemento grafico) di una scena, con entrata e uscita opzionale. */
export const Layer = z.object({
  id: z.string().min(1),
  component: ComponentName,
  props: z.record(z.unknown()).default({}),
  enter: AnimSpec,
  /** Uscita opzionale; se assente il layer resta fino a fine scena. */
  exit: AnimSpec.partial({ anim: true, ms: true }).optional(),
});
export type Layer = z.infer<typeof Layer>;

/** Sfondo di una scena (al momento: tinta piatta). */
export const SceneBackground = z.object({
  kind: z.enum(['solid']).default('solid'),
  color: z.string(),
});
export type SceneBackground = z.infer<typeof SceneBackground>;

/**
 * Illustrazione di scena (stile explainer "Brain Bites"): un'immagine 2D cartoon
 * generata dal `prompt`, usata come SFONDO animato della scena (Ken Burns). A
 * generazione, il provider produce l'immagine e popola `src` (data URL o
 * storageKey); l'LLM fornisce solo il `prompt`.
 */
export const SceneIllustration = z.object({
  /** Descrizione dell'illustrazione (soggetto/azione/ambientazione). */
  prompt: z.string().min(1),
  /** Sorgente dell'immagine risolta (riempita dal provider; assente a monte). */
  src: z.string().optional(),
  /** Movimento di camera sull'immagine. */
  kenBurns: z.enum(['in', 'out', 'left', 'right', 'none']).default('in'),
});
export type SceneIllustration = z.infer<typeof SceneIllustration>;

/**
 * Una scena del video. La durata è 'auto' (derivata dal voiceover) oppure
 * esplicita in ms. `illustration` (stile B) rende la scena un'illustrazione
 * cartoon animata con testo/sottotitoli sopra; `layers` resta per i componenti
 * grafici (diagrammi, stat) quando servono.
 */
export const Scene = z.object({
  id: z.string().min(1),
  durationHint: z.union([z.literal('auto'), z.number().int().positive()]).default('auto'),
  background: SceneBackground.optional(),
  illustration: SceneIllustration.optional(),
  layers: z.array(Layer).default([]),
  /**
   * Finestra di PAROLE del voiceover GLOBALE coperta da questa scena, per i
   * video MULTI-SCENA con un unico voiceover: `start`/`end` sono indici di
   * parola (0-based, `end` esclusivo). La durata della scena va dall'inizio
   * della parola `start` alla fine della parola `end-1`. Se assente, la scena
   * usa `durationHint` (compat. col vecchio modello "una scena = tutto il
   * voiceover"). L'LLM lo valorizza suddividendo il voiceover tra le scene.
   */
  wordRange: z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).optional(),
});
export type Scene = z.infer<typeof Scene>;

/** Dimensioni e frame rate del canvas video. */
export const Canvas = z.object({
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
  fps: z.number().int().positive().max(60).default(30),
});
export type Canvas = z.infer<typeof Canvas>;

/** Tema grafico: palette, sfondo, font. */
export const VideoTheme = z.object({
  palette: z.array(z.string()).min(1),
  bg: z.string(),
  fontFamily: z.string().default('Inter'),
});
export type VideoTheme = z.infer<typeof VideoTheme>;

/** Voiceover dell'intero video: testo, lingua, voce opzionale. */
export const Voiceover = z.object({
  text: z.string().min(1),
  lang: z.string().min(2),
  voiceId: z.string().optional(),
});
export type Voiceover = z.infer<typeof Voiceover>;

/** Sceneggiatura completa del cartoon. */
export const VideoSpec = z.object({
  version: z.literal(1),
  canvas: Canvas,
  theme: VideoTheme,
  voiceover: Voiceover,
  scenes: z.array(Scene).min(1),
});
export type VideoSpec = z.infer<typeof VideoSpec>;
