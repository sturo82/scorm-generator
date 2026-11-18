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
  return storage.run({ payer }, fn);
}

/** Apre un contesto per ogni richiesta HTTP, che l'auth guard riempirà. */
@Injectable()
export class PayerMiddleware implements NestMiddleware {
  use(_req: unknown, _res: unknown, next: () => void): void {
    storage.run({}, next);
  }
}
