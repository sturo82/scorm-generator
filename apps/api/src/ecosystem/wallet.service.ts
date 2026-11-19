import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { EcosystemHttpService, EcosystemRequestError } from './ecosystem-http.service.js';
import { EcosystemSettingsService } from './ecosystem-settings.service.js';

/** Hold creato (o già esistente, per idempotenza) sul wallet di Manager. */
export interface WalletHold {
  holdId: string;
  company_id?: string;
  product?: string;
  feature?: string;
  amount?: number;
  units?: number;
  reference?: string;
  status?: string;
  available?: number;
  expiresAt?: string;
}

export interface CreateHoldInput {
  companyId: string;
  /** Feature a consumo del listino (es. 'text_standard', 'video_avatar_iii_twin'). */
  feature: string;
  /** Feature a unità (elemento o minuto): quantità da riservare, anche decimale. Manager calcola prezzo × unità iniziate. */
  units?: number;
  /** Feature fissa: crediti uguali al prezzo di listino. */
  amount?: number;
  /**
   * Id univoco e STABILE dell'operazione nel prodotto. È l'idempotency key:
   * retry sicuri, nessun doppio addebito. Es. `kscorm:job:<jobId>:text_standard`.
   */
  reference: string;
}

/** Saldo del wallet di una company (sola lettura). */
export interface WalletBalance {
  company_id?: string;
  balance: number;
  available: number;
  currency?: string;
  /** Se Manager lo espone: false = pagamenti Stripe in modalità di prova. */
  livemode?: boolean;
  /** Ultima ricarica (ISO), se Manager la espone. */
  last_topup_at?: string | null;
}
/** Riga dei movimenti di Manager. */
export interface WalletMovement {
  id: string;
  type: string;
  affects_balance?: boolean;
  amount: number;
  product?: string;
  feature?: string;
  reference?: string;
  balance_after?: number;
  created_at: string;
}
export interface WalletMovementsPage {
  page: number;
  page_size: number;
  pages: number;
  total: number;
  results: WalletMovement[];
}

/** Errore quando il wallet della company non ha crediti sufficienti. */
export class InsufficientCreditsException extends HttpException {
  constructor(
    readonly feature: string,
    readonly required: number | undefined,
    readonly available: number | undefined,
  ) {
    super(
      {
        error: 'insufficient_credits',
        feature,
        required,
        available,
        message: 'Crediti insufficienti per questa operazione.',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/** Errore quando l'azienda non ha un wallet su Manager: non può generare finché non lo attiva. */
export class CompanyWalletMissingException extends HttpException {
  constructor(readonly companyId: string) {
    super(
      {
        error: 'company_wallet_missing',
        message: "La tua azienda non ha un wallet attivo: per generare serve il wallet aziendale o quello personale.",
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
/** Errore quando una spesa supererebbe il budget (preventivo) del corso: serve la conferma dell'utente. */
export class OverBudgetException extends HttpException {
  constructor(readonly over: number, readonly budget: number, readonly committed: number, readonly cost: number) {
    super(
      {
        error: 'over_budget',
        over,
        budget,
        committed,
        cost,
        message: `Questa operazione costa ${over} crediti oltre il preventivo del corso.`,
      },
      HttpStatus.CONFLICT,
    );
  }
}
/** Errore quando il wallet personale non è ammesso su questo prodotto. */
export class PersonalWalletNotAllowedException extends HttpException {
  constructor() {
    super(
      { error: 'personal_wallet_not_allowed', message: 'Il wallet personale non è abilitato per questa funzione.' },
      HttpStatus.FORBIDDEN,
    );
  }
}

/** Wallet personale di un utente: Manager lo tratta come una company con id "p-…". */
export interface PersonalWallet extends WalletBalance {
  company_id: string;
}

/** Errore quando la feature non ha ancora un prezzo nel listino di Manager. */
export class FeatureNotPricedException extends HttpException {
  constructor(readonly feature: string) {
    super(
      {
        error: 'feature_not_priced',
        feature,
        message: 'Questa funzione non è ancora disponibile a pagamento.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

/** Errore quando Manager (wallet) è momentaneamente non disponibile. */
export class WalletUnavailableException extends HttpException {
  constructor() {
    super(
      {
        error: 'wallet_unavailable',
        message: 'Servizio momentaneamente non disponibile, riprova.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

/** Corpo di errore di Manager: `{ error, error_description, available? }`. */
interface ManagerError {
  error?: string;
  error_description?: string;
  available?: number;
}

/**
 * Wallet d'ecosistema (fonte di verità: Manager). Pattern a RISERVA per ogni
 * feature a pagamento:
 *
 *   1) hold(...)   PRIMA di eseguire → riserva i crediti;
 *   2) capture(...) a fine operazione riuscita → addebita il consumo reale
 *      (può essere ≤ riservato; la differenza viene liberata). UNA sola capture per hold;
 *   3) release(...) su errore/annullamento → libera la riserva.
 *
 * Prezzi: decisi solo da Manager. Feature a unità → si manda `units` (Manager calcola prezzo ×
 * unità iniziate); feature fissa → `amount` uguale al prezzo. Idempotenza garantita dal
 * `reference`. Se il wallet non è abilitato, i metodi sono no-op silenziosi (ritornano un hold
 * fittizio) così il codice chiamante resta identico tra ambienti con/senza wallet attivo.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private readonly productKey: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly http: EcosystemHttpService,
    private readonly settings: EcosystemSettingsService,
  ) {
    this.productKey = config.get('ecosystem', { infer: true }).productKey;
  }

  /** Abilitato = flag effettivo (Manager comanda, env fallback) + M2M configurato. */
  async isEnabled(): Promise<boolean> {
    return this.settings.walletEnabled && (await this.http.isConfigured());
  }

  /** Saldo della company (sola lettura). Null se il wallet non è abilitato o non raggiungibile. */
  async getBalance(companyId: string): Promise<WalletBalance | null> {
    if (!(await this.isEnabled())) return null;
    try {
      return await this.http.get<WalletBalance>('wallet', { company_id: companyId });
    } catch (err) {
      this.logger.warn(`Lettura saldo wallet fallita (company=${companyId}): ${describe(err)}`);
      return null;
    }
  }

  /**
   * Wallet della company su Manager: `ok` con saldo, `missing` se Manager non ha la company,
   * `error` se non raggiungibile (in quel caso non si blocca qui: ci pensa l'hold).
   */
  async companyWallet(companyId: string): Promise<{ status: 'ok'; balance: WalletBalance } | { status: 'missing' | 'error' }> {
    if (!(await this.isEnabled())) return { status: 'error' };
    try {
      return { status: 'ok', balance: await this.http.get<WalletBalance>('wallet', { company_id: companyId }) };
    } catch (err) {
      if (err instanceof EcosystemRequestError && err.status === 404) return { status: 'missing' };
      this.logger.warn(`Lettura wallet company fallita (company=${companyId}): ${describe(err)}`);
      return { status: 'error' };
    }
  }
  /** Movimenti del wallet (una pagina). Null se il wallet non è abilitato o non raggiungibile. */
  async getTransactions(companyId: string, page: number, pageSize: number): Promise<WalletMovementsPage | null> {
    if (!(await this.isEnabled())) return null;
    try {
      return await this.http.get<WalletMovementsPage>('wallet/transactions', {
        company_id: companyId,
        page: String(page),
        page_size: String(pageSize),
        product: this.productKey,
      });
    } catch (err) {
      this.logger.warn(`Lettura movimenti fallita (company=${companyId}): ${describe(err)}`);
      return null;
    }
  }
  /**
   * Ottiene (e crea se manca) il wallet personale dell'utente. Lo stesso `sub` dà sempre lo stesso
   * `company_id`, che va usato così com'è. Chiamarlo solo quando l'utente apre o sceglie il wallet
   * personale, non a ogni accesso: crea il wallet se non esiste.
   */
  async getOrCreatePersonal(sub: string, email: string): Promise<PersonalWallet> {
    if (!(await this.isEnabled())) throw new WalletUnavailableException();
    try {
      return await this.http.post<PersonalWallet>('wallet/personal', { product: this.productKey, sub, email });
    } catch (err) {
      if (err instanceof EcosystemRequestError && err.status === 403) throw new PersonalWalletNotAllowedException();
      this.logger.error(`Attivazione wallet personale fallita: ${describe(err)}`);
      throw new WalletUnavailableException();
    }
  }

  /**
   * Pagina di pagamento Stripe per ricaricare il wallet personale. I crediti arrivano solo dal
   * webhook firmato di Stripe, anche dopo il ritorno dell'utente.
   */
  async createPersonalTopupSession(input: {
    companyId: string;
    amountEur: number;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }> {
    if (!(await this.isEnabled())) throw new WalletUnavailableException();
    try {
      return await this.http.post<{ url: string }>('wallet/personal/topup-session', {
        product: this.productKey,
        company_id: input.companyId,
        amount_eur: input.amountEur,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });
    } catch (err) {
      if (err instanceof EcosystemRequestError) {
        const code = asManagerError(err.body).error;
        if (err.status === 400 && code === 'invalid_amount') {
          throw new HttpException({ error: 'invalid_amount', message: 'Importo di ricarica non valido.' }, HttpStatus.BAD_REQUEST);
        }
      }
      this.logger.error(`Sessione di ricarica personale fallita: ${describe(err)}`);
      throw new WalletUnavailableException();
    }
  }

  /**
   * Riserva crediti PRIMA di eseguire la feature. Lancia InsufficientCreditsException se il
   * saldo non basta e FeatureNotPricedException se la feature non è prezzata. Se disabilitato,
   * no-op.
   */
  async hold(input: CreateHoldInput): Promise<WalletHold> {
    if (!(await this.isEnabled())) {
      return { holdId: `noop:${input.reference}`, status: 'noop' };
    }
    let raw: WalletHold & { hold_id?: unknown; id?: unknown };
    try {
      raw = await this.http.post<WalletHold & { hold_id?: unknown; id?: unknown }>('wallet/holds', {
        company_id: input.companyId,
        product: this.productKey,
        feature: input.feature,
        reference: input.reference,
        ...(input.units !== undefined ? { units: round3(input.units) } : {}),
        ...(input.amount !== undefined ? { amount: Math.round(input.amount) } : {}),
      });
    } catch (err) {
      this.mapHoldError(err, input);
    }
    // Manager restituisce l'id dell'hold come numero: lo si usa sempre come stringa.
    const id = raw.holdId ?? raw.hold_id ?? raw.id;
    if (id === undefined || id === null || id === '') {
      this.logger.error(`Wallet hold senza id (ref=${input.reference}): la riserva scadrà da sola`);
      throw new WalletUnavailableException();
    }
    return { ...raw, holdId: String(id) };
  }
  private mapHoldError(err: unknown, input: CreateHoldInput): never {
    if (err instanceof EcosystemRequestError) {
      const body = asManagerError(err.body);
      if (err.status === 403 && body.error === 'personal_wallet_not_allowed') {
        throw new PersonalWalletNotAllowedException();
      }
      if (err.status === 404 && body.error === 'company_not_found') {
        throw new CompanyWalletMissingException(input.companyId);
      }
      if (err.status === 409 && body.error === 'feature_not_priced') {
        throw new FeatureNotPricedException(input.feature);
      }
      if (err.status === 409) {
        throw new InsufficientCreditsException(input.feature, input.amount, body.available);
      }
    }
    this.logger.error(`Wallet hold fallito (ref=${input.reference}): ${describe(err)}`);
    throw new WalletUnavailableException();
  }

  /**
   * Addebita il consumo reale su un hold (una sola capture per hold). Feature a unità: `units`
   * = consumo reale; fissa: `amount` minore del prezzo oppure nulla per l'intera riserva. Senza
   * parametri addebita l'intera riserva. Se disabilitato, no-op. Non lancia: un capture fallito
   * lascia l'hold che Manager libera a scadenza.
   */
  async capture(companyId: string, holdId: string, actual?: { units?: number; amount?: number }): Promise<boolean> {
    if (String(holdId).startsWith('noop:') || !(await this.isEnabled())) return false;
    try {
      await this.http.post(`wallet/holds/${encodeURIComponent(holdId)}/capture`, {
        company_id: companyId,
        ...(actual?.units !== undefined ? { units: round3(actual.units) } : {}),
        ...(actual?.amount !== undefined ? { amount: Math.round(actual.amount) } : {}),
      });
      return true;
    } catch (err) {
      if (err instanceof EcosystemRequestError) {
        const code = asManagerError(err.body).error;
        // Idempotente: già catturato/chiuso, nulla da fare.
        if (code === 'hold_already_captured') return true;
        if (code === 'hold_not_open') return false;
        if (code === 'capture_exceeds_hold') {
          this.logger.error(`Wallet capture oltre la riserva (hold=${holdId}): consumo reale superiore a quanto prenotato`);
          return false;
        }
      }
      this.logger.error(`Wallet capture fallito (hold=${holdId}): ${describe(err)}`);
    }
    return false;
  }

  /**
   * Libera un hold (operazione fallita/annullata). Idempotente e best-effort: non lancia, così
   * non maschera l'errore originale che ha innescato il release.
   */
  async release(companyId: string, holdId: string): Promise<void> {
    if (String(holdId).startsWith('noop:') || !(await this.isEnabled())) return;
    try {
      await this.http.post(`wallet/holds/${encodeURIComponent(holdId)}/release`, {
        company_id: companyId,
      });
    } catch (err) {
      this.logger.warn(`Wallet release fallito (hold=${holdId}): ${describe(err)}`);
    }
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function asManagerError(body: unknown): ManagerError {
  return body && typeof body === 'object' ? (body as ManagerError) : {};
}

function describe(err: unknown): string {
  if (err instanceof EcosystemRequestError) {
    const code = asManagerError(err.body).error;
    return `HTTP ${err.status ?? 'n/d'}${code ? ` ${code}` : ''}`;
  }
  return err instanceof Error ? err.message : String(err);
}
