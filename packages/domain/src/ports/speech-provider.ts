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
}

export interface SpeechSynthesizeResult {
  /** Byte dell'audio. */
  bytes: Uint8Array;
  /** MIME dell'audio (es. audio/mpeg). */
  contentType: string;
  /** Voce/engine usati (per audit). */
  voice: string;
}

export interface SpeechProvider {
  readonly id: string;
  synthesize(input: SpeechSynthesizeInput): Promise<SpeechSynthesizeResult>;
}
