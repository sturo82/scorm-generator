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

export interface SpeechProvider {
  readonly id: string;
  synthesize(input: SpeechSynthesizeInput): Promise<SpeechSynthesizeResult>;
}
