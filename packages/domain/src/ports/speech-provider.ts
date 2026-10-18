/**
 * Porta per la sintesi vocale (text-to-speech). Astrae il provider concreto
 * (default: Amazon Polly) (Requisito 4.2 / 5.5 / 10). L'audio generato
 * (narrazione delle lezioni) popola `MediaRef.storageKey` dei media audio.
 */
export interface SpeechSynthesizeInput {
  /** Testo da sintetizzare. */
  text: string;
  /** Codice lingua (es. "it-IT"); il provider sceglie una voce coerente. */
  language?: string;
  /** Voce specifica del provider (es. "Bianca"); prevale su language. */
  voice?: string;
  /**
   * Motore di sintesi: 'standard' (economico) o 'neural' (qualità superiore, più
   * costoso). Se assente, il provider usa il proprio default. Per-richiesta:
   * consente di scegliere la qualità a livello di corso o di singola generazione.
   */
  engine?: 'standard' | 'neural';
}

export interface SpeechSynthesizeResult {
  /** Byte dell'audio. */
  bytes: Uint8Array;
  /** MIME dell'audio (es. audio/mpeg). */
  contentType: string;
  /** Voce usata (per audit). */
  voice: string;
  /** Engine effettivamente usato (per audit/metering). */
  engine?: 'standard' | 'neural';
}

/**
 * Timestamp di una parola del parlato (speech mark): usato per sincronizzare
 * grafica e testo con la voce nel code-to-video. Forma allineata a `WordMark`
 * di @scorm/contracts (tipo duplicato qui per non far dipendere il domain dai
 * contratti).
 */
export interface SpeechWordMark {
  word: string;
  startMs: number;
  endMs: number;
}

/** Risultato della sintesi CON i timestamp a livello di parola. */
export interface SpeechSynthesizeWithMarksResult extends SpeechSynthesizeResult {
  /** Timestamp di ogni parola del voiceover, in ordine. */
  marks: SpeechWordMark[];
}

export interface SpeechProvider {
  readonly id: string;
  synthesize(input: SpeechSynthesizeInput): Promise<SpeechSynthesizeResult>;
  /**
   * Sintesi CON speech marks a livello di parola (per il sync del code-to-video).
   * Opzionale: i provider che non la supportano la lasciano non implementata
   * (il chiamante ricade su `synthesize`). Additiva, non rompe gli adapter.
   */
  synthesizeWithMarks?(input: SpeechSynthesizeInput): Promise<SpeechSynthesizeWithMarksResult>;
}
