/**
 * Fatturazione a crediti (wallet di Manager): nomi delle feature del listino e mappe condivise
 * tra API e web. I PREZZI non sono qui: li decide solo Manager e arrivano dal suo listino.
 */

/** Fascia di tariffa avatar HeyGen secondo engine e tipo di avatar (come nel listino di Manager). */
export function avatarFeature(engine: string, avatarType: string): string {
  const e = engine.toLowerCase();
  if (e === 'avatar_v') return 'video_avatar_v';
  if (e === 'avatar_iv') return avatarType === 'photo' ? 'video_avatar_iv_photo' : 'video_avatar_iv';
  return avatarType === 'digital_twin' ? 'video_avatar_iii_twin' : 'video_avatar_iii';
}

/**
 * Tetto di immagini generate per lezione, per formato. È un limite rigido (il codice non ne genera
 * oltre) e fa parte del prezzo dei pacchetti lezione: alzarlo cambia il caso peggiore su cui Manager
 * calcola il prezzo.
 */
export const LESSON_IMAGE_CAP: Readonly<Record<'standard' | 'pillola' | 'pillola_interattiva' | 'video_first', number>> = {
  standard: 6,
  pillola: 2,
  pillola_interattiva: 2,
  video_first: 1,
};

/** Tetto di immagini della lezione per un formato (formati sconosciuti: quello della lezione standard). */
export function lessonImageCap(format: string | null | undefined): number {
  return LESSON_IMAGE_CAP[(format ?? 'standard') as keyof typeof LESSON_IMAGE_CAP] ?? LESSON_IMAGE_CAP.standard;
}

/**
 * Pacchetti a prezzo fisso (listino di Manager): un pezzo di corso finito, non una chiamata AI.
 * Se Manager non li ha ancora prezzati si usa il listino per operazione (`text_standard`, `image_generation`).
 */
export const PACKAGE_FEATURES = {
  structure: 'course_structure',
  test: 'course_test',
  lesson: {
    standard: 'lesson_standard',
    pillola: 'lesson_pillola',
    pillola_interattiva: 'lesson_pillola_interattiva',
    video_first: 'lesson_video_first',
  },
} as const;

/** Pacchetto della lezione per formato (formati sconosciuti: lezione standard). */
export function lessonPackageFeature(format: string | null | undefined): string {
  return PACKAGE_FEATURES.lesson[(format ?? 'standard') as keyof typeof PACKAGE_FEATURES.lesson] ?? PACKAGE_FEATURES.lesson.standard;
}

/** Tutte le feature dei pacchetti. */
export const ALL_PACKAGE_FEATURES: readonly string[] = [
  PACKAGE_FEATURES.structure,
  PACKAGE_FEATURES.test,
  ...Object.values(PACKAGE_FEATURES.lesson),
];

/**
 * Limiti dei media generati, verificati sui dati di produzione con margine sopra il massimo
 * osservato (così non tagliano un contenuto premium). Servono a prenotare e a preventivare il
 * massimo reale di ogni operazione.
 */
export const MEDIA_CAPS = {
  /** Video-lezione della pillola: il prompt chiede 450-750 parole; massimo osservato 6,2 minuti. */
  pillolaVideoMaxWords: 900,
  /** 900 parole a circa 2,3 parole/s più le schede di sezione: entro 7 minuti. */
  pillolaVideoMaxMinutes: 7,
  /** Scena breve (libro-game, aggancio): il prompt chiede 2-4 frasi; mediana osservata 24 secondi. */
  sceneMaxWords: 120,
  sceneMaxMinutes: 1,
  /** Scene video di una pillola interattiva per avvio (massimo osservato 9). */
  interactiveMaxScenes: 12,
  /** Narrazione di una lezione, per il preventivo (massimo osservato 8.377 caratteri). */
  narrationMaxChars: 12_000,
  /** Video avatar di una lezione: copione entro 140 parole (osservati 48-52 secondi). */
  avatarVideoMaxMinutes: 1,
} as const;

/**
 * Operazioni di testo (`text_standard`) prenotate per strutturare la knowledge: una per testi brevi,
 * più chiamate (mappa + fusione) per testi lunghi. Stima per eccesso dalla dimensione dei file.
 */
export function knowledgeStructureUnits(totalBytes: number): number {
  const estWords = Math.min(60000, totalBytes / 6);
  return estWords <= 9000 ? 1 : Math.ceil(estWords / 6000) + 1;
}

/**
 * Limiti dei copioni del video da slide, come li chiede il prompt: servono al preventivo prima dei
 * copioni. Se poi l'autore allunga i copioni, il prezzo esatto compare al passo delle clip.
 */
export const SLIDE_SCRIPT_CAPS = {
  /** Parole massime per slide con le sole slide. */
  slidesOnlyMaxWords: 130,
  /** Parole massime per slide con la knowledge (il prompt indica 80-250). */
  knowledgeMaxWords: 250,
  /** Slide aggiuntive dalla knowledge e loro parole massime. */
  extraSlides: 8,
  extraMaxWords: 120,
  /** Parole al secondo del parlato (come la stima dei copioni). */
  wordsPerSec: 2.4,
  /** Sezioni massime proposte. */
  maxSections: 8,
} as const;

/** Voce del preventivo di un video da slide. */
export interface SlideEstimateLine {
  kind: 'scripts' | 'sections' | 'clips' | 'render' | 'summaries' | 'quizzes';
  quantity: number;
  credits: number | null;
}

/** Preventivo massimo di un video da slide prima dei copioni (due ipotesi: solo slide o con knowledge). */
export interface SlideImportEstimateView {
  billed: boolean;
  slides: number;
  slidesOnly: { minutes: number; lines: SlideEstimateLine[]; total: number; priced: boolean };
  withKnowledge: { minutes: number; lines: SlideEstimateLine[]; total: number; priced: boolean };
}

/**
 * Limiti di token delle chiamate AI dei pacchetti (ingresso stimato prima della chiamata, uscita
 * come `maxTokens`). Sono i limiti su cui Manager ha calcolato i prezzi: alzarli richiede di
 * rialzare il listino. Massimi osservati in produzione: lezione 11.298 in / 12.292 out, pillola
 * 2.629 out, pillola interattiva 4.051 out, test 6.295 in / 7.798 out, struttura 5.144 in / 5.225 out.
 */
export const GENERATION_LIMITS = {
  structure: { inputTokens: 8_000, outputTokens: 7_000 },
  test: { inputTokens: 9_000, outputTokens: 10_000 },
  lesson: {
    standard: { inputTokens: 16_000, outputTokens: 13_000 },
    pillola: { inputTokens: 16_000, outputTokens: 6_000 },
    pillola_interattiva: { inputTokens: 16_000, outputTokens: 8_000 },
    video_first: { inputTokens: 16_000, outputTokens: 10_000 },
  },
} as const;

/** Limiti della lezione per formato (formati sconosciuti: lezione standard). */
export function lessonGenerationLimits(format: string | null | undefined): { inputTokens: number; outputTokens: number } {
  return GENERATION_LIMITS.lesson[(format ?? 'standard') as keyof typeof GENERATION_LIMITS.lesson] ?? GENERATION_LIMITS.lesson.standard;
}

/**
 * Stima per eccesso dei token di ingresso di una chiamata: il testo (system e messaggio) a 2,5
 * caratteri per token, lo schema JSON dello strumento a 2 (il JSON è più denso), più 500 token di
 * istruzioni che il provider aggiunge per l'uso degli strumenti. Tarata sui consumi reali.
 */
export function estimateInputTokens(text: Array<string | undefined>, schema?: object): number {
  const textChars = text.reduce<number>((n, p) => n + (p?.length ?? 0), 0);
  const schemaChars = schema ? JSON.stringify(schema).length : 0;
  return Math.ceil(textChars / 2.5 + schemaChars / 2 + (schema ? 500 : 0));
}

/** Tentativi massimi di generazione di una lezione o di un test (anche questo entra nel caso peggiore). */
export const GENERATION_MAX_ATTEMPTS = 2;

/** Voce di un preventivo in crediti: feature e, per quelle a unità, le unità (elementi o minuti). */
export interface CreditQuoteItem {
  feature: string;
  units?: number;
}

/** Risposta del preventivo: `billed` indica se l'azienda paga davvero la generazione. */
export interface CreditQuoteView {
  billed: boolean;
  lines: Array<{ feature: string; units: number; credits: number | null }>;
  total: number;
  priced: boolean;
}

/** Wallet a crediti di un soggetto pagante (azienda o personale). */
export interface WalletBlock {
  balance?: number;
  available?: number;
  /** Data (ISO) dell'ultima ricarica, se Manager la espone. */
  lastTopupAt?: string;
}

/**
 * Accesso dell'utente a un wallet di azienda:
 * - `active`: Manager ha un wallet per l'azienda;
 * - `missing`: Manager non ha un wallet per l'azienda: si genera solo con il wallet personale;
 * - `unavailable`: wallet non abilitato o non raggiungibile in questo momento;
 * - `none`: nessuna azienda (spazio personale).
 */
export type CompanyWalletAccess = 'active' | 'missing' | 'unavailable' | 'none';

/** Crediti addebitati per un corso, per funzione (quanto ha pagato il cliente). */
export interface CourseCreditsView {
  courseId: string;
  total: number;
  lines: Array<{ feature: string; units?: number; operations: number; credits: number }>;
}

/** Movimento del wallet che cambia il saldo (ricarica, addebito, rettifica, rimborso). */
export interface WalletTransaction {
  id: string;
  type: string;
  amount: number;
  feature?: string;
  product?: string;
  balanceAfter?: number;
  createdAt: string;
}

export interface WalletTransactionsView {
  page: number;
  pages: number;
  total: number;
  results: WalletTransaction[];
}

/**
 * Stato dei wallet mostrato in app. I campi `enabled/balance/available/topupUrl/canTopup` riguardano
 * il wallet che paga le generazioni in corso (`payer`); `company` e `personal` descrivono i due
 * wallet per la pagina di gestione.
 */
export interface WalletView {
  /** True se le generazioni si pagano in crediti (wallet abilitato sull'installazione da Manager). */
  enabled: boolean;
  /** Wallet scelto per pagare: azienda o personale. */
  payer: 'COMPANY' | 'PERSONAL';
  balance?: number;
  available?: number;
  currency: 'CREDITS';
  topupUrl?: string;
  canTopup: boolean;
  /** Wallet dell'azienda; assente se Manager non ne ha uno per l'azienda. */
  company: (WalletBlock & { topupUrl?: string; canTopup: boolean; canViewMovements: boolean }) | null;
  /** Se e perché l'utente può usare un wallet di azienda. */
  companyAccess: CompanyWalletAccess;
  /** Identificativo dell'azienda a cui appartiene l'utente (assente nello spazio personale). */
  companyId?: string;
  /** Wallet personale: `active` è false finché l'utente non lo attiva (Manager lo crea alla prima richiesta). */
  personal: WalletBlock & { active: boolean };
  /** True se il wallet è abilitato sull'installazione (quindi l'utente può attivare quello personale). */
  personalAvailable: boolean;
  /** True se l'utente lavora nel proprio spazio personale (senza company): paga sempre il wallet personale. */
  personalSpace: boolean;
  /** True se Stripe è in modalità di prova: le ricariche non sono reali. Assente se non ancora noto. */
  stripeTestMode?: boolean;
}
