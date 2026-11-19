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

/**
 * Evento globale «fuori preventivo»: l'API risponde 409 `over_budget` quando una spesa supererebbe
 * il budget del corso. L'http-client chiede conferma con il dialog nel layout e, se l'utente
 * conferma, ripete la stessa richiesta autorizzando i crediti in più.
 */
export const OVER_BUDGET_EVENT = 'scorm:over-budget';

export interface OverBudgetDetail {
  /** Crediti oltre il budget. */
  over: number;
  budget: number;
  committed: number;
  /** Costo massimo dell'operazione. */
  cost: number;
  resolve: (confirmed: boolean) => void;
}

/** Ritorna i dati del 409 se è un "fuori preventivo", altrimenti null. */
export function parseOverBudget(bodyText: string): Omit<OverBudgetDetail, 'resolve'> | null {
  try {
    const b = JSON.parse(bodyText) as Record<string, unknown>;
    if (b.error !== 'over_budget') return null;
    const n = (v: unknown) => (typeof v === 'number' ? v : 0);
    return { over: n(b.over), budget: n(b.budget), committed: n(b.committed), cost: n(b.cost) };
  } catch {
    return null;
  }
}

let declinedAt = 0;

/** True se l'utente ha appena rifiutato una spesa fuori preventivo (per non mostrare un toast d'errore). */
export function overBudgetJustDeclined(windowMs = 2500): boolean {
  return Date.now() - declinedAt < windowMs;
}

/** Chiede conferma all'utente; senza dialog montato (es. fuori dall'app) rifiuta. */
export function confirmOverBudget(detail: Omit<OverBudgetDetail, 'resolve'>): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    let answered = false;
    const done = (ok: boolean) => {
      if (answered) return;
      answered = true;
      if (!ok) declinedAt = Date.now();
      resolve(ok);
    };
    window.dispatchEvent(new CustomEvent<OverBudgetDetail>(OVER_BUDGET_EVENT, { detail: { ...detail, resolve: done } }));
  });
}
