import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';

export type EnforceMode = 'off' | 'soft' | 'hard';

/**
 * Impostazioni d'ecosistema **effettive** a runtime. Fonte di verità: Manager
 * (opzione b). I valori di env sono il **default/fallback**; la risposta del
 * self-register (`enforce`, `walletEnabled`) li **sovrascrive** quando presente.
 *
 * Così lo stato d'attivazione (gate soft/hard, wallet on/off) lo comanda Manager
 * senza bisogno di redeploy del prodotto. Se Manager non risponde (self-register
 * fallito), restano i valori di env.
 */
@Injectable()
export class EcosystemSettingsService {
  private readonly logger = new Logger(EcosystemSettingsService.name);

  private _enforce: EnforceMode;
  private _walletEnabled: boolean;
  /** True quando i valori provengono da Manager (self-register ok). */
  private _fromManager = false;

  constructor(config: ConfigService<AppConfig, true>) {
    const cfg = config.get('ecosystem', { infer: true });
    this._enforce = cfg.entitlementEnforce;
    this._walletEnabled = cfg.walletEnabled;
  }

  get enforce(): EnforceMode {
    return this._enforce;
  }

  get walletEnabled(): boolean {
    return this._walletEnabled;
  }

  get fromManager(): boolean {
    return this._fromManager;
  }

  /**
   * Applica i valori ricevuti da Manager al self-register. Ignora i campi
   * assenti/non validi (mantiene il fallback di env per quelli).
   */
  applyFromManager(input: { enforce?: unknown; walletEnabled?: unknown }): void {
    let changed = false;
    if (input.enforce === 'off' || input.enforce === 'soft' || input.enforce === 'hard') {
      this._enforce = input.enforce;
      changed = true;
    }
    if (typeof input.walletEnabled === 'boolean') {
      this._walletEnabled = input.walletEnabled;
      changed = true;
    }
    if (changed) {
      this._fromManager = true;
      this.logger.log(
        `Impostazioni d'ecosistema da Manager: enforce=${this._enforce} walletEnabled=${this._walletEnabled}`,
      );
    }
  }
}
