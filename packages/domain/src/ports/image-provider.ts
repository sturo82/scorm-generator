/**
 * Porta per la generazione di immagini da testo (text-to-image). Astrae il
 * provider concreto (default: Stability Stable Image su Amazon Bedrock)
 * (Requisito 4.2 / 5.5 / 10). I media generati sostituiscono i placeholder dei
 * Block popolando `MediaRef.storageKey`.
 */
export interface ImageGenerateInput {
  /** Descrizione testuale dell'immagine da generare (dal placeholderPrompt). */
  prompt: string;
  /** Prompt negativo opzionale (cosa evitare). */
  negativePrompt?: string;
  /** Dimensioni in pixel; il provider può arrotondare ai valori supportati. */
  width?: number;
  height?: number;
  /** Seme per riproducibilità, se supportato. */
  seed?: number;
}

export interface ImageGenerateResult {
  /** Byte dell'immagine generata. */
  bytes: Uint8Array;
  /** MIME dell'immagine (es. image/png). */
  contentType: string;
  /** Modello che ha prodotto l'immagine (per audit). */
  model: string;
}

export interface ImageProvider {
  readonly id: string;
  generate(input: ImageGenerateInput): Promise<ImageGenerateResult>;
}
