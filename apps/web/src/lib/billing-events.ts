/**
 * Evento globale «crediti insufficienti»: l'http-client lo emette quando l'API risponde 402, il
 * dialog nel layout lo mostra con il pulsante di ricarica. Evita di gestire il 402 in ogni
 * pulsante di generazione.
 */
export const INSUFFICIENT_CREDITS_EVENT = 'scorm:insufficient-credits';

export interface InsufficientCreditsDetail {
  required?: number;
  available?: number;
  feature?: string;
  /** Codice d'errore dell'API (es. `company_wallet_missing`). */
  error?: string;
}

let lastAt = 0;

/** True se un avviso «crediti insufficienti» è appena stato mostrato (per non duplicare i toast d'errore). */
export function insufficientCreditsJustShown(windowMs = 2500): boolean {
  return Date.now() - lastAt < windowMs;
}

/** Notifica il 402; `bodyText` è il corpo grezzo della risposta (JSON dell'API, se leggibile). */
export function notifyInsufficientCredits(bodyText: string): void {
  if (typeof window === 'undefined') return;
  let detail: InsufficientCreditsDetail = {};
  try {
    const b = JSON.parse(bodyText) as Record<string, unknown>;
    detail = {
      required: typeof b.required === 'number' ? b.required : undefined,
      available: typeof b.available === 'number' ? b.available : undefined,
      feature: typeof b.feature === 'string' ? b.feature : undefined,
      error: typeof b.error === 'string' ? b.error : undefined,
    };
  } catch {
    /* corpo non JSON: l'avviso resta generico */
  }
  lastAt = Date.now();
  window.dispatchEvent(new CustomEvent<InsufficientCreditsDetail>(INSUFFICIENT_CREDITS_EVENT, { detail }));
}
