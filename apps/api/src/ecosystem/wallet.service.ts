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
  reference?: string;
  status?: string;
}

export interface CreateHoldInput {
  companyId: string;
  /** Feature a consumo (es. 'video', 'tts', 'export'). */
  feature: string;
  /** Crediti da riservare (secondo il listino d'ecosistema). */
  amount: number;
  /**
   * Id univoco e STABILE dell'operazione nel prodotto. È l'idempotency key:
   * retry sicuri, nessun doppio addebito. Es. `kscorm:job:<jobId>:video:<id>`.
   */
  reference: string;
}

/** Errore quando il wallet della company non ha crediti sufficienti. */
export class InsufficientCreditsException extends HttpException {
  constructor(readonly feature: string, readonly amount: number) {
    super(
      {
        error: 'insufficient_credits',
        feature,
        amount,
        message: 'Crediti insufficienti per questa operazione.',
      },
      HttpStatus.PAYMENT_REQUIRED,
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

/**
 * Wallet d'ecosistema (fonte di verità: Manager). Pattern a RISERVA per ogni
 * feature a pagamento:
 *
 *   1) hold(...)   PRIMA di eseguire → riserva i crediti;
 *   2) capture(...) a fine operazione riuscita → addebita il consumo reale
 *      (può essere ≤ amount; la differenza viene liberata);
 *   3) release(...) su errore/annullamento → libera la riserva.
 *
 * Idempotenza garantita dal `reference`. Se `WALLET_ENABLED=false`, i metodi
 * sono no-op silenziosi (ritornano un hold fittizio) così il codice chiamante
 * resta identico tra ambienti con/senza wallet attivo.
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

  /**
   * Riserva crediti PRIMA di eseguire la feature. Lancia
   * InsufficientCreditsException su 409. Se disabilitato, no-op.
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
        amount: input.amount,
        reference: input.reference,
      });
    } catch (err) {
      if (err instanceof EcosystemRequestError && err.status === 409) {
        throw new InsufficientCreditsException(input.feature, input.amount);
      }
      this.logger.error(`Wallet hold fallito (ref=${input.reference}): ${describe(err)}`);
      throw new WalletUnavailableException();
    }
  }

  /**
   * Addebita il consumo reale su un hold. `amount` può essere ≤ a quello
   * riservato; omettendolo si cattura l'intero hold. Se disabilitato, no-op.
   * `companyId` è richiesto da Manager nel body.
   */
  async capture(companyId: string, holdId: string, amount?: number): Promise<void> {
    if (holdId.startsWith('noop:') || !(await this.isEnabled())) return;
    try {
      await this.http.post(`wallet/holds/${encodeURIComponent(holdId)}/capture`, {
        company_id: companyId,
        ...(amount !== undefined ? { amount } : {}),
      });
    } catch (err) {
      // Un capture fallito lascia l'hold che Manager auto-rilascia a scadenza:
      // logghiamo ma non facciamo fallire l'operazione utente già riuscita.
      this.logger.error(`Wallet capture fallito (hold=${holdId}): ${describe(err)}`);
    }
  }

  /**
   * Libera un hold (operazione fallita/annullata). Best-effort: non lancia, così
   * non maschera l'errore originale che ha innescato il release. `companyId` è
   * richiesto da Manager nel body.
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

  /**
   * Esegue `work` dentro un hold: capture del consumo reale se riesce, release
   * se lancia. Il consumo reale è il valore ritornato da `work` (default:
   * l'intero hold). Rende semplice il pattern corretto per i chiamanti.
   */
  async withHold<T>(
    input: CreateHoldInput,
    work: () => Promise<{ result: T; consumed?: number }>,
  ): Promise<T> {
    const held = await this.hold(input);
    try {
      const { result, consumed } = await work();
      await this.capture(input.companyId, held.holdId, consumed);
      return result;
    } catch (err) {
      await this.release(input.companyId, held.holdId);
      throw err;
    }
  }
}

function describe(err: unknown): string {
  if (err instanceof EcosystemRequestError) {
    return `HTTP ${err.status ?? 'n/d'}`;
  }
  return err instanceof Error ? err.message : String(err);
}
