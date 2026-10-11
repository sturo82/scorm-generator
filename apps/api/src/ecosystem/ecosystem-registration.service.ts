import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { EcosystemHttpService } from './ecosystem-http.service.js';
import { EcosystemSettingsService } from './ecosystem-settings.service.js';

/** Risposta attesa dal self-register (campi opzionali pilotati da Manager). */
interface SelfRegisterResponse {
  installationId?: string;
  status?: string;
  enforce?: unknown;
  walletEnabled?: unknown;
}

/** Mapping eco-role → ruolo interno di K Scorm, inviato a Manager solo per display. */
const KSCORM_ECO_ROLE_MAP = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'EDITOR',
  VIEWER: 'VIEWER',
} as const;

/**
 * Self-register: all'avvio l'installazione si **annuncia** a Manager
 * (`POST /installations/self`). È idempotente (Manager fa upsert su
 * `installationId`) e **non bloccante**: se Manager non risponde, l'app parte
 * comunque e si ritenta al prossimo avvio. Ciò che conta per l'accesso è il gate
 * al login (EntitlementService), non questo annuncio.
 *
 * Attivo solo se `ECOSYSTEM_SELF_REGISTER=true` e il client M2M è configurato.
 */
@Injectable()
export class EcosystemRegistrationService implements OnModuleInit {
  private readonly logger = new Logger(EcosystemRegistrationService.name);
  private readonly cfg: AppConfig['ecosystem'];

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly http: EcosystemHttpService,
    private readonly settings: EcosystemSettingsService,
  ) {
    this.cfg = config.get('ecosystem', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    if (!this.cfg.selfRegisterEnabled) return;
    if (!this.http.isConfigured()) {
      this.logger.warn(
        'Self-register abilitato ma ecosystem M2M non configurato: salto l\'annuncio',
      );
      return;
    }
    // Non blocca il boot: eseguiamo in background e logghiamo l'esito.
    void this.register();
  }

  /** Annuncia l'installazione a Manager. Best-effort: non lancia. */
  async register(): Promise<void> {
    const body = {
      product: this.cfg.productKey,
      installationId: this.cfg.installationId,
      region: this.cfg.installationRegion,
      domains: this.cfg.installationDomains,
      ecoRoleMap: KSCORM_ECO_ROLE_MAP,
    };
    try {
      const res = await this.http.post<SelfRegisterResponse>('installations/self', body);
      // Opzione b: Manager comanda enforce/walletEnabled; applichiamo i valori
      // ricevuti (sovrascrivono i default di env).
      this.settings.applyFromManager({
        enforce: res?.enforce,
        walletEnabled: res?.walletEnabled,
      });
      this.logger.log(
        `Self-register ok: product=${this.cfg.productKey} installation=${this.cfg.installationId} status=${res?.status ?? 'n/d'}`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Self-register non riuscito (installation=${this.cfg.installationId}): ${reason} — l'app prosegue, si ritenta al prossimo avvio`,
      );
    }
  }
}
