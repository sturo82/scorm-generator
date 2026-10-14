/**
 * Stima dei token da testo per il metering degli embeddings.
 *
 * Il provider embeddings restituisce solo i vettori, non il conteggio token di
 * input. Per il billing stimiamo i token con la convenzione standard ~4
 * caratteri/token (coerente con la documentazione AWS "~4.7 char/token in
 * inglese" e con la stima usata altrove). È un'approssimazione: il costo degli
 * embeddings è comunque marginale rispetto all'LLM, quindi l'errore in valore è
 * trascurabile.
 */
export function estimateTokensFromText(texts: string[]): number {
  const chars = texts.reduce((sum, t) => sum + (t ? t.length : 0), 0);
  return Math.max(0, Math.ceil(chars / 4));
}
