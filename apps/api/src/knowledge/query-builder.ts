/**
 * Costruisce il testo della query RAG combinando l'obiettivo didattico con il
 * contesto del brief (Requisito 3.5). Mantiene la query focalizzata ma
 * contestualizzata, così il retrieval privilegia i chunk pertinenti alla
 * lezione in corso.
 */
export interface QueryContext {
  /** Obiettivo della lezione o della sezione da generare. */
  objective: string;
  /** Titolo del corso, per contesto. */
  courseTitle?: string;
  /** Pubblico target dal brief. */
  audience?: string;
  /** Parole chiave aggiuntive dal brief. */
  keywords?: string[];
}

export function buildRetrievalQuery(ctx: QueryContext): string {
  const parts: string[] = [ctx.objective];
  if (ctx.courseTitle) parts.push(`Corso: ${ctx.courseTitle}`);
  if (ctx.audience) parts.push(`Pubblico: ${ctx.audience}`);
  if (ctx.keywords && ctx.keywords.length > 0) {
    parts.push(`Temi: ${ctx.keywords.join(', ')}`);
  }
  return parts.join('. ');
}
