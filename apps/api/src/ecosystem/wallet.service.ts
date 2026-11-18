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
   * Riserva crediti PRIMA di eseguire la feature. Lancia InsufficientCreditsException se il
   * saldo non basta e FeatureNotPricedException se la feature non è prezzata. Se disabilitato,
   * no-op.
   */
  async hold(input: CreateHoldInput): Promise<WalletHold> {
    if (!(await this.isEnabled())) {
      return { holdId: `noop:${input.reference}`, status: 'noop' };
    }
    try {
      return await this.http.post<WalletHold>('wallet/holds', {
        company_id: input.companyId,
        product: this.productKey,
        feature: input.feature,
        reference: input.reference,
        ...(input.units !== undefined ? { units: round3(input.units) } : {}),
        ...(input.amount !== undefined ? { amount: Math.round(input.amount) } : {}),
      });
    } catch (err) {
      if (err instanceof EcosystemRequestError) {
        const body = asManagerError(err.body);
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
  }

  /**
   * Addebita il consumo reale su un hold (una sola capture per hold). Feature a unità: `units`
   * = consumo reale; fissa: `amount` minore del prezzo oppure nulla per l'intera riserva. Senza
   * parametri addebita l'intera riserva. Se disabilitato, no-op. Non lancia: un capture fallito
   * lascia l'hold che Manager libera a scadenza.
   */
  async capture(companyId: string, holdId: string, actual?: { units?: number; amount?: number }): Promise<void> {
    if (holdId.startsWith('noop:') || !(await this.isEnabled())) return;
    try {
      await this.http.post(`wallet/holds/${encodeURIComponent(holdId)}/capture`, {
        company_id: companyId,
        ...(actual?.units !== undefined ? { units: round3(actual.units) } : {}),
        ...(actual?.amount !== undefined ? { amount: Math.round(actual.amount) } : {}),
      });
    } catch (err) {
      if (err instanceof EcosystemRequestError) {
        const code = asManagerError(err.body).error;
        // Idempotente: già catturato/chiuso, nulla da fare.
        if (code === 'hold_already_captured' || code === 'hold_not_open') return;
        if (code === 'capture_exceeds_hold') {
          this.logger.error(`Wallet capture oltre la riserva (hold=${holdId}): consumo reale superiore a quanto prenotato`);
          return;
        }
      }
      this.logger.error(`Wallet capture fallito (hold=${holdId}): ${describe(err)}`);
    }
  }

  /**
   * Libera un hold (operazione fallita/annullata). Idempotente e best-effort: non lancia, così
   * non maschera l'errore originale che ha innescato il release.
   */
  async release(companyId: string, holdId: string): Promise<void> {
    if (holdId.startsWith('noop:') || !(await this.isEnabled())) return;
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
