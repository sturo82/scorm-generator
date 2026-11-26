import { z } from 'zod';
import { LanguageCode } from './primitives.js';

/**
 * Podcast: una SERIE di puntate audio su un tema, raccontate da due conduttori in dialogo.
 * Contenuto autonomo (non è una lezione di un corso). Vedi .kiro/specs/podcast.
 */

/** Limiti della generazione (anche per il preventivo). */
export const PODCAST_LIMITS = {
  /** Puntate per serie: una serie cresce nel tempo, una puntata alla volta. */
  maxEpisodes: 200,
  /** Idee di puntata chieste in una volta. */
  maxIdeas: 10,
  minMinutes: 3,
  maxMinutes: 20,
  /** Ritmo di parlato di partenza (parole al minuto); si tara sulle prime puntate generate. */
  wordsPerMinute: 150,
  /** Il copione deve stare tra questi rapporti rispetto alla durata richiesta. */
  minRatio: 0.8,
  maxRatio: 1.15,
  minTurns: 4,
  maxTurns: 600,
  /** Caratteri massimi di una battuta: sotto il limite di una chiamata di sintesi (circa 3000). */
  maxTurnChars: 1200,
  maxArticles: 6,
  maxDocs: 10,
} as const;

export const PodcastHostKey = z.enum(['A', 'B']);
export type PodcastHostKey = z.infer<typeof PodcastHostKey>;

/** Chi produce la voce: Amazon Polly o HeyGen (voci del catalogo e voci proprie clonate). */
export const PodcastVoiceProvider = z.enum(['polly', 'heygen']);
export type PodcastVoiceProvider = z.infer<typeof PodcastVoiceProvider>;

/** Voce di un conduttore: del catalogo del fornitore, oppure (in futuro) clonata. */
export const PodcastVoiceRef = z.object({
  kind: z.enum(['catalog', 'clone']).default('catalog'),
  /** Le serie create prima di HeyGen non lo hanno: sono voci Polly. */
  provider: PodcastVoiceProvider.default('polly'),
  id: z.string().min(1).max(64),
});
export type PodcastVoiceRef = z.infer<typeof PodcastVoiceRef>;

export const PodcastHost = z.object({
  key: PodcastHostKey,
  name: z.string().trim().min(1).max(40),
  voice: PodcastVoiceRef,
});
export type PodcastHost = z.infer<typeof PodcastHost>;

/** Esattamente due conduttori, A e B. */
export const PodcastHosts = z
  .array(PodcastHost)
  .length(2)
  .refine((h) => h.some((x) => x.key === 'A') && h.some((x) => x.key === 'B'), 'Servono i conduttori A e B');

/** Linea editoriale della serie: vale per tutte le puntate. Ogni campo è facoltativo. */
export const PodcastBrief = z.object({
  topic: z.string().trim().max(500).default(''),
  audience: z.string().trim().max(300).optional(),
  tone: z.string().trim().max(200).optional(),
  objectives: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
  /** Durata di partenza di una nuova puntata (minuti). */
  episodeMinutes: z.number().int().min(PODCAST_LIMITS.minMinutes).max(PODCAST_LIMITS.maxMinutes).default(8),
});
export type PodcastBrief = z.infer<typeof PodcastBrief>;

/** Articolo (di un feed RSS) scelto come fonte. */
export const PodcastArticleRef = z.object({
  title: z.string().trim().min(1).max(300),
  url: z.string().trim().url().max(2000),
});
export type PodcastArticleRef = z.infer<typeof PodcastArticleRef>;

export const PodcastFeedVisibility = z.enum(['PUBLIC', 'PRIVATE']);
export type PodcastFeedVisibility = z.infer<typeof PodcastFeedVisibility>;

export const PodcastEpisodeState = z.enum(['DRAFT', 'WRITING', 'SCRIPT_READY', 'VOICING', 'READY', 'FAILED']);
export type PodcastEpisodeState = z.infer<typeof PodcastEpisodeState>;

/**
 * Categorie principali di Apple Podcasts. Le maiuscole contano: nel feed una categoria scritta in
 * modo diverso (es. "Kids & family") non viene riconosciuta.
 */
export const PODCAST_CATEGORIES = [
  'Arts',
  'Business',
  'Comedy',
  'Education',
  'Fiction',
  'Government',
  'History',
  'Health & Fitness',
  'Kids & Family',
  'Leisure',
  'Music',
  'News',
  'Religion & Spirituality',
  'Science',
  'Society & Culture',
  'Sports',
  'Technology',
  'True Crime',
  'TV & Film',
] as const;
export const PodcastCategory = z.enum(PODCAST_CATEGORIES);
export type PodcastCategory = z.infer<typeof PodcastCategory>;

/** Copertina: quadrata, da 1400 a 3000 px, JPEG o PNG (requisito di Apple Podcasts). */
export const PODCAST_COVER = { minPx: 1400, maxPx: 3000, maxBytes: 10 * 1024 * 1024 } as const;

const PodcastMeta = {
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().max(1000).default(''),
  category: PodcastCategory.default('Education'),
  author: z.string().trim().max(100).optional(),
  contactEmail: z.string().trim().email().max(200).optional(),
  explicit: z.boolean().default(false),
};

/**
 * Creazione di una serie: solo il contenitore (dati generali, conduttori, linea editoriale). Le puntate
 * si aggiungono dopo, una alla volta, ciascuna con le sue fonti.
 */
export const CreatePodcast = z.object({
  ...PodcastMeta,
  language: LanguageCode.default('it'),
  hosts: PodcastHosts,
  brief: PodcastBrief.default({}),
  /** Cartella di organizzazione (omessa = radice). */
  folderId: z.string().min(1).nullable().optional(),
});
export type CreatePodcast = z.infer<typeof CreatePodcast>;

export const UpdatePodcast = z.object({
  title: PodcastMeta.title.optional(),
  description: z.string().trim().max(1000).optional(),
  category: PodcastCategory.optional(),
  author: z.string().trim().max(100).nullable().optional(),
  contactEmail: z.string().trim().email().max(200).nullable().optional(),
  explicit: z.boolean().optional(),
  hosts: PodcastHosts.optional(),
  brief: PodcastBrief.optional(),
});
export type UpdatePodcast = z.infer<typeof UpdatePodcast>;

export const SetPodcastFeed = z.object({ visibility: PodcastFeedVisibility });
export type SetPodcastFeed = z.infer<typeof SetPodcastFeed>;

/** Elenco ordinato delle puntate (piano): senza `id` = nuova, id assente dall'elenco = tolta. */
export const UpdatePodcastEpisodes = z.object({
  episodes: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        title: z.string().trim().min(1).max(140),
        summary: z.string().trim().max(1000).default(''),
        targetMinutes: z.number().int().min(PODCAST_LIMITS.minMinutes).max(PODCAST_LIMITS.maxMinutes).optional(),
        /** Se assenti, restano quelli già salvati. */
        notes: z.string().trim().max(2000).optional(),
        knowledgeDocIds: z.array(z.string().min(1)).max(PODCAST_LIMITS.maxDocs).optional(),
        articles: z.array(PodcastArticleRef).max(PODCAST_LIMITS.maxArticles).optional(),
      }),
    )
    .min(1)
    .max(PODCAST_LIMITS.maxEpisodes),
});
export type UpdatePodcastEpisodes = z.infer<typeof UpdatePodcastEpisodes>;

/** Una nuova puntata: di cosa parla e da quali fonti nasce. Si aggiunge in fondo alla serie. */
export const CreatePodcastEpisode = z.object({
  title: z.string().trim().min(1).max(140),
  /** Di cosa parla (2-3 frasi). */
  summary: z.string().trim().max(1000).default(''),
  /** Indicazioni per chi scrive il copione: taglio, cose da dire o da evitare. */
  notes: z.string().trim().max(2000).default(''),
  targetMinutes: z.number().int().min(PODCAST_LIMITS.minMinutes).max(PODCAST_LIMITS.maxMinutes).optional(),
  knowledgeDocIds: z.array(z.string().min(1)).max(PODCAST_LIMITS.maxDocs).default([]),
  articles: z.array(PodcastArticleRef).max(PODCAST_LIMITS.maxArticles).default([]),
});
export type CreatePodcastEpisode = z.infer<typeof CreatePodcastEpisode>;

/** Richiesta di idee per le prossime puntate (non crea nulla). */
export const SuggestPodcastIdeas = z.object({
  count: z.number().int().min(1).max(PODCAST_LIMITS.maxIdeas).default(5),
  /** Argomento su cui orientare le idee (facoltativo). */
  focus: z.string().trim().max(500).optional(),
});
export type SuggestPodcastIdeas = z.infer<typeof SuggestPodcastIdeas>;

export interface PodcastIdea {
  title: string;
  summary: string;
}

/** Una battuta: chi parla e cosa dice. */
export const PodcastTurn = z.object({
  host: PodcastHostKey,
  text: z.string().trim().min(1).max(PODCAST_LIMITS.maxTurnChars),
});
export type PodcastTurn = z.infer<typeof PodcastTurn>;

export const PodcastScript = z.object({
  turns: z.array(PodcastTurn).min(PODCAST_LIMITS.minTurns).max(PODCAST_LIMITS.maxTurns),
});
export type PodcastScript = z.infer<typeof PodcastScript>;

export const UpdatePodcastScript = PodcastScript;

/** Parole di un copione. */
export function podcastScriptWords(script: { turns: Array<{ text: string }> }): number {
  return script.turns.reduce((n, t) => n + t.text.split(/\s+/).filter(Boolean).length, 0);
}

/** Parole consentite per una puntata di `minutes` minuti. */
export function podcastWordBudget(
  minutes: number,
  wordsPerMinute: number = PODCAST_LIMITS.wordsPerMinute,
): { min: number; target: number; max: number } {
  const w = Math.max(0, minutes) * wordsPerMinute;
  return {
    min: Math.max(1, Math.floor(w * PODCAST_LIMITS.minRatio)),
    target: Math.max(1, Math.round(w)),
    max: Math.max(1, Math.floor(w * PODCAST_LIMITS.maxRatio)),
  };
}

/** Esito della taratura di un copione rispetto alla durata richiesta. */
export function podcastScriptFit(
  words: number,
  minutes: number,
  wordsPerMinute: number = PODCAST_LIMITS.wordsPerMinute,
): { status: 'empty' | 'short' | 'ok' | 'long'; estMinutes: number; budget: ReturnType<typeof podcastWordBudget> } {
  const budget = podcastWordBudget(minutes, wordsPerMinute);
  const estMinutes = Math.round((words / wordsPerMinute) * 10) / 10;
  const status = words === 0 ? 'empty' : words > budget.max ? 'long' : words < budget.min ? 'short' : 'ok';
  return { status, estMinutes, budget };
}

export const PodcastTurnTiming = z.object({ i: z.number().int().nonnegative(), startMs: z.number().nonnegative(), endMs: z.number().nonnegative() });
export type PodcastTurnTiming = z.infer<typeof PodcastTurnTiming>;

/** Fonte usata da una puntata (documento di knowledge o articolo). */
export const PodcastSource = z.object({ kind: z.enum(['document', 'article']), title: z.string(), url: z.string().optional() });
export type PodcastSource = z.infer<typeof PodcastSource>;

/** Voce del catalogo del fornitore. */
export const PodcastVoiceOption = z.object({
  /** Identificativo univoco tra fornitori: `provider:id`. */
  key: z.string(),
  provider: PodcastVoiceProvider,
  id: z.string(),
  name: z.string(),
  gender: z.enum(['female', 'male', 'unknown']),
  language: z.string(),
  /** Voce propria dell'account (clonata): non del catalogo. */
  mine: z.boolean().default(false),
  /** La lingua della serie non è quella originale della voce: può avere un accento straniero. */
  accent: z.boolean().default(false),
  /** Audio di prova già pronto, se il fornitore lo offre. */
  previewUrl: z.string().optional(),
});
export type PodcastVoiceOption = z.infer<typeof PodcastVoiceOption>;

export interface PodcastEpisodeView {
  id: string;
  position: number;
  title: string;
  summary: string;
  targetMinutes: number;
  state: PodcastEpisodeState;
  error?: string;
  script: PodcastScript | null;
  words: number;
  audioStale: boolean;
  hasAudio: boolean;
  durationSec?: number;
  sizeBytes?: number;
  turnTimings?: PodcastTurnTiming[];
  /** Fonti scelte per la puntata e indicazioni di chi la propone. */
  notes: string;
  knowledgeDocIds: string[];
  articles: PodcastArticleRef[];
  /** Fonti effettivamente usate dal copione. */
  sources: PodcastSource[];
  published: boolean;
  publishedAt?: string;
}

export interface PodcastView {
  id: string;
  title: string;
  description: string;
  language: string;
  category: string;
  author?: string;
  contactEmail?: string;
  explicit: boolean;
  hosts: PodcastHost[];
  brief: PodcastBrief;
  knowledgeDocIds: string[];
  articles: PodcastArticleRef[];
  visibility: PodcastFeedVisibility;
  /** Copertina (link a scadenza) e dimensioni; `coverOk` = rispetta i requisiti per il feed. */
  cover?: { url: string; width: number; height: number; ok: boolean };
  /** Indirizzo del feed RSS; assente se la pubblicazione non è configurata. */
  feedUrl?: string;
  /** Cose che le piattaforme richiedono e che mancano (non bloccano il feed). */
  feedWarnings: string[];
  /** True se il server può pubblicare (dominio e distribuzione configurati). */
  publishingEnabled: boolean;
  episodes: PodcastEpisodeView[];
  createdAt: string;
  updatedAt: string;
}

export interface PodcastListItem {
  id: string;
  title: string;
  description: string;
  language: string;
  category: string;
  author?: string;
  /** Nomi dei conduttori. */
  hostNames: string[];
  folderId: string | null;
  visibility: PodcastFeedVisibility;
  /** Copertina (link a scadenza). */
  coverUrl?: string;
  episodeCount: number;
  readyCount: number;
  publishedCount: number;
  updatedAt: string;
}

/** Preventivo in crediti di un passo della generazione. */
export interface PodcastEstimateView {
  billed: boolean;
  priced: boolean;
  total: number;
  lines: Array<{ kind: 'plan' | 'scripts' | 'audio'; quantity: number; credits: number | null }>;
}

/** Chiave di una voce, uguale per Polly e HeyGen. */
export const podcastVoiceKey = (v: { provider?: PodcastVoiceProvider; id: string }): string => `${v.provider ?? 'polly'}:${v.id}`;
