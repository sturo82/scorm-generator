import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, type NestMiddleware } from '@nestjs/common';

/**
 * Chi paga una generazione: il wallet dell'azienda (`company_id` = tenant) oppure il wallet
 * personale dell'utente (`company_id` "p-…" assegnato da Manager, che lo tratta come una company).
 */
export interface Payer {
  companyId: string;
  kind: 'company' | 'personal';
}

interface PayerStore {
  payer?: Payer;
  /** Crediti oltre il budget del corso confermati dall'utente per questa richiesta (header `x-credit-confirm`). */
  creditConfirm?: number;
  /** True dentro un lavoro in background: il budget è già stato controllato quando il lavoro è partito. */
  inJob?: boolean;
}

/**
 * Pagatore della richiesta corrente. Si imposta una volta, nell'auth guard, dopo aver letto la
 * scelta dell'utente; le chiamate di fatturazione lo leggono da qui senza che ogni servizio debba
 * ricevere l'utente. I lavori in background lo ricevono dal loro payload (`runWithPayer`).
 */
const storage = new AsyncLocalStorage<PayerStore>();

export function currentPayer(): Payer | undefined {
  return storage.getStore()?.payer;
}

/** Imposta il pagatore della richiesta in corso (chiamato dall'auth guard). */
export function setRequestPayer(payer: Payer | undefined): void {
  const store = storage.getStore();
  if (store) store.payer = payer;
}

/** Esegue `fn` con il pagatore indicato (per i job in background, che non hanno una richiesta). */
export function runWithPayer<T>(payer: Payer | undefined, fn: () => T): T {
  return storage.run({ payer, inJob: true }, fn);
}

/** Crediti oltre il budget confermati dall'utente nella richiesta corrente (0 se nessuna conferma). */
export function currentCreditConfirm(): number {
  return storage.getStore()?.creditConfirm ?? 0;
}

/** True dentro un lavoro in background (il controllo del budget è stato fatto all'avvio). */
export function inBackgroundJob(): boolean {
  return storage.getStore()?.inJob === true;
}

/** Apre un contesto per ogni richiesta HTTP, che l'auth guard riempirà. */
@Injectable()
export class PayerMiddleware implements NestMiddleware {
  use(req: { headers?: Record<string, string | string[] | undefined> }, _res: unknown, next: () => void): void {
    const raw = req.headers?.['x-credit-confirm'];
    const n = Number(Array.isArray(raw) ? raw[0] : raw);
    storage.run({ creditConfirm: Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined }, next);
  }
}
