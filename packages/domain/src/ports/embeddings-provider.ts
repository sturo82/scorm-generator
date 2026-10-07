/**
 * Porta per la generazione di embeddings. Astrae il provider concreto
 * (default: Amazon Bedrock) (Requisito 3.8 / 10). La dimensione del vettore
 * dipende dal provider e determina la configurazione del vector store.
 */
export interface EmbeddingsProvider {
  readonly id: string;
  /** Dimensione dei vettori prodotti (es. 1024). */
  readonly dimensions: number;
  /** Restituisce un embedding per ciascun testo, nello stesso ordine. */
  embed(texts: string[]): Promise<number[][]>;
}
