/**
 * Messaggio leggibile da un errore dell'API ("API 403: {...}"): il testo del server se c'è, con una
 * spiegazione per i casi più comuni, altrimenti `fallback`.
 */
export function apiErrorText(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : '';
  const status = Number(/^API (\d+)/.exec(raw)?.[1] ?? 0);
  let msg = raw.replace(/^API \d+:\s*/, '');
  try {
    const j = JSON.parse(msg) as { message?: string | string[] };
    if (j?.message) msg = Array.isArray(j.message) ? j.message.join('. ') : j.message;
  } catch {
    /* testo semplice */
  }
  if (status === 403 && /ruolo/i.test(msg)) return 'Serve il ruolo di amministratore dell\u2019azienda per questa operazione.';
  if (status === 409 && /Unique constraint|already exists|esiste già/i.test(msg)) return 'Esiste già un elemento con questo nome.';
  return msg && msg.length < 240 ? msg : fallback;
}
