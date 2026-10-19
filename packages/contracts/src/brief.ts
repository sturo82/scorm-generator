import { z } from 'zod';
import { Id, LanguageCode } from './primitives.js';
import { LessonFormat } from './course.js';

/**
 * Brief iniziale del corso (Requisito 2). Input strutturato che guida la
 * generazione AI di outline e contenuti.
 */

export const ProficiencyLevel = z.enum(['beginner', 'intermediate', 'advanced']);
export type ProficiencyLevel = z.infer<typeof ProficiencyLevel>;

/**
 * Formato del corso: determina la modalità di fruizione e il tipo di contenuti
 * generati.
 *  - 'completo'    : formato classico (testo, immagini, interazioni, quiz).
 *  - 'video_first' : ogni lezione è incentrata su un video (equivale a videoFirst).
 *  - 'pillole'     : mini-video interattivi in stile libro-game — scene brevi
 *                    (cartoon), scelte con conseguenze (punteggio/feedback) che
 *                    instradano alla scena successiva. Ogni pillola è una lezione
 *                    con un block branching_scenario.
 */
export const CourseFormat = z.enum(['completo', 'video_first', 'pillole']);
export type CourseFormat = z.infer<typeof CourseFormat>;

/** Tipi di test richiesti nel corso (Requisito 2.1 / 6.3). */
export const RequestedAssessment = z.enum(['intermediate', 'final']);
export type RequestedAssessment = z.infer<typeof RequestedAssessment>;

export const Brief = z.object({
  title: z.string().min(1),
  learningObjectives: z.array(z.string().min(1)).min(1),
  targetAudience: z.string().min(1),
  level: ProficiencyLevel,
  /** Durata stimata del corso in minuti. */
  estimatedDurationMinutes: z.number().int().positive(),
  language: LanguageCode,
  /** Tono di voce desiderato; il tono di brand ha precedenza se presente. */
  tone: z.string().optional(),
  /**
   * Taglio/scope del corso: l'ANGOLAZIONE con cui trattare l'argomento per
   * servire il pubblico (es. "applicativo: come il docente usa questi strumenti
   * in classe"). Vincola outline e lezioni a restare dentro l'obiettivo reale
   * del corso, escludendo temi pertinenti al titolo ma fuori dall'obiettivo.
   */
  courseFocus: z.string().optional(),
  /** Numero indicativo di lezioni desiderate. */
  desiredLessonCount: z.number().int().positive().optional(),
  /**
   * Lezioni suggerite (titoli) usate come STRUTTURA DI PARTENZA per l'outline:
   * provengono dall'anteprima approvata dall'autore (corso da argomento). La
   * generazione le rifinisce senza stravolgerle, così il corso resta coerente
   * con ciò che l'anteprima ha promesso. Vuoto = outline libero dal brief.
   */
  suggestedLessons: z.array(z.string().min(1)).default([]),
  requestedAssessments: z.array(RequestedAssessment).default([]),
  constraints: z.array(z.string()).default([]),
  /** Brand associati al corso già in fase di brief (Requisito 2.5). */
  brandIds: z.array(Id).default([]),
  /**
   * Documenti della knowledge base da usare per la generazione (whitelist). Se
   * vuoto, la generazione usa tutta la knowledge pertinente per similarità
   * (comportamento di default); se valorizzato, limita il RAG a questi documenti.
   */
  knowledgeDocIds: z.array(Id).default([]),
  /**
   * Sottoinsieme di knowledgeDocIds che costituisce le FONTI del corso: i
   * documenti su cui il corso è costruito (articoli ingeriti dal flusso "da
   * argomento" + knowledge esistente agganciata). La UI li distingue dalla
   * knowledge aggiuntiva e avvisa se vengono deselezionati. Non altera il RAG
   * (che usa knowledgeDocIds): è solo un marcatore di provenienza.
   */
  courseSourceDocIds: z.array(Id).default([]),
  /**
   * Se true (default), dopo la generazione dei contenuti di una lezione vengono
   * generate automaticamente le immagini illustrative. Disattivabile per
   * risparmiare tempo/budget (le immagini restano generabili manualmente).
   */
  autoGenerateImages: z.boolean().default(true),
  /**
   * Corso "video-first": se true, OGNI lezione è incentrata su un video (con un
   * segnaposto video da riempire caricando il file) affiancato da elementi
   * dinamici e quiz. Si può comunque marcare singole lezioni come video-first
   * anche quando questo è false (vedi flag per-lezione).
   *
   * NB: campo STORICO mantenuto per compatibilità. La fonte di verità del
   * formato è `format`; `videoFirst` resta allineato (true sse format ==
   * 'video_first') ed è ancora usato dai prompt/player esistenti.
   */
  videoFirst: z.boolean().default(false),
  /**
   * Formato del corso (vedi CourseFormat). Default 'completo'. Guida la
   * generazione: 'video_first' → lezioni incentrate su video; 'pillole' →
   * libro-game di scene/scelte/conseguenze. Retro-compat: se assente ma
   * videoFirst==true, va trattato come 'video_first'.
   *
   * NB: con il formato PER-LEZIONE (lessonFormatDefault/lessonFormatHints), il
   * valore 'completo' qui significa "nessun formato globale forzato": l'outline
   * decide il formato lezione per lezione. 'video_first'/'pillole' restano come
   * forzatura globale (tutte le lezioni ricevono quel formato).
   */
  format: CourseFormat.default('completo'),
  /**
   * Formato PER-LEZIONE consigliato di DEFAULT (onboarding unificato): l'outline
   * assegna questo formato alle lezioni per cui non c'è un hint specifico, salvo
   * che il modello ritenga chiaramente più adatto un altro formato. Se assente,
   * l'LLM sceglie liberamente il mix. Ignorato se `format` forza un formato globale.
   */
  lessonFormatDefault: LessonFormat.optional(),
  /**
   * Eccezioni di formato per-lezione, indicizzate per TITOLO (normalizzato) della
   * lezione suggerita: { "<titolo>": "pillola"|"video_first"|"standard" }. L'outline
   * applica questo formato alle lezioni il cui titolo combacia. Ignorato se `format`
   * forza un formato globale.
   */
  lessonFormatHints: z.record(z.string(), LessonFormat).default({}),
});
export type Brief = z.infer<typeof Brief>;

/**
 * Variante "draft" del brief: tutti i campi opzionali per consentire il
 * salvataggio di bozze parziali (Requisito 2.4). I default sensati e i campi
 * mancanti vengono gestiti a livello applicativo (Requisito 2.3).
 */
export const BriefDraft = Brief.partial();
export type BriefDraft = z.infer<typeof BriefDraft>;
