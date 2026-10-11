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
 *
 * ─── TODO (onboarding ad attrito zero — vedi docs/ECOSYSTEM-ZEROTOUCH-ONBOARDING.md) ───
 * Oggi questo servizio usa SOLO il Bearer M2M (richiede che le credenziali M2M
 * siano già configurate). Per l'onboarding automatico "da prodotto nuovo" manca,
 * da implementare QUANDO Manager accende `workload_auth_enabled` in staging:
 *
 *   1) WORKLOAD-IDENTITY (primo giro, senza M2M): costruire una richiesta
 *      `sts:GetCallerIdentity` PRE-FIRMATA SigV4 con le credenziali del ruolo di
 *      esecuzione (default credential chain dell'SDK AWS) e allegarla come campo
 *      `stsRequest` nel body. Host STS REGIONALE (sts.<region>.amazonaws.com, mai
 *      il globale). Firmare AL MOMENTO della chiamata (finestra 5 min).
 *   2) RETRY SU 202: `202 pending_approval` NON è un errore → ritentare in
 *      background (es. ogni retryAfterSec) finché un operatore approva l'ARN in
 *      console; non bloccare mai il boot.
 *   3) PROVISIONING KIT (200): persistere `m2m.clientSecret` (mostrato una volta)
 *      nel secret store; usare `oidc.clientId` come audience e servirlo al web a
 *      runtime (config dinamica, non build-time); applicare `settings`.
 *   4) GIRI SUCCESSIVI: usare il Bearer M2M (come ora); `rotateM2m:true` per
 *      ruotare il secret.
 *
 * Finché il flag Manager è OFF, l'endpoint accetta solo Bearer M2M: questo
 * servizio resta corretto così com'è e il TODO è inerte in produzione.
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
