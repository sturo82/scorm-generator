/**
 * Porta per la trascrizione automatica (ASR, speech-to-text) di un video/audio.
 * Astrae il provider concreto (default: Amazon Transcribe). Produce segmenti di
 * parlato con timestamp (cue) usati per la trascrizione sincronizzata "karaoke"
 * nelle lezioni video-first. Il mock di sviluppo genera cue plausibili senza
 * chiamare un servizio esterno.
 */

/** Un segmento di parlato con il suo intervallo temporale (secondi). */
export interface TranscriptSegment {
  /** Secondo di inizio del segmento. */
  start: number;
  /** Secondo di fine del segmento. */
  end: number;
  /** Testo del segmento. */
  text: string;
  /** Etichetta di chi parla, se la diarizzazione è disponibile. */
  speaker?: string;
}

export interface TranscribeInput {
  /** Chiave storage del file audio/video da trascrivere. */
  storageKey: string;
  /** MIME del file (es. video/mp4), per aiutare il provider. */
  contentType?: string;
  /** Codice lingua atteso (es. "it-IT"); se assente il provider auto-rileva. */
  language?: string;
}

export interface TranscribeResult {
  /** Segmenti con timestamp, ordinati per start crescente. */
  segments: TranscriptSegment[];
  /** Lingua rilevata/usata (per audit). */
  language?: string;
}

/** Esito del recupero di un job di trascrizione asincrono. */
export type TranscribeJobResult =
  | { status: 'processing' }
  | { status: 'completed'; result: TranscribeResult }
  | { status: 'failed'; reason: string };

export interface TranscriptionProvider {
  readonly id: string;
  /**
   * Trascrizione sincrona (avvia + attende): comoda ma non resiliente a un
   * riavvio del processo durante l'attesa. Preferire startJob/fetchJob quando
   * il provider li implementa, così lo stato è ripristinabile dal DB.
   */
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
  /**
   * Avvia un job asincrono e ritorna un riferimento persistibile (es. il nome
   * del job su Amazon Transcribe). Opzionale: se assente, usare transcribe().
   */
  startJob?(input: TranscribeInput): Promise<{ jobRef: string }>;
  /**
   * Recupera lo stato/risultato di un job avviato con startJob. Opzionale.
   * Idempotente: può essere richiamato dopo un riavvio del processo.
   */
  fetchJob?(jobRef: string): Promise<TranscribeJobResult>;
}
