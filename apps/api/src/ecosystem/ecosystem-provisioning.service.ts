import {
  CreateSecretCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EcosystemCredentialsService } from './ecosystem-credentials.service.js';
import { EcosystemSettingsService } from './ecosystem-settings.service.js';
import { buildSignedStsRequest } from './sts-request.js';

/** Riga singola persistente che rappresenta questa installazione. */
const INSTALLATION_ROW_ID = 'self';

/** Mapping eco-role → ruolo interno di K Scorm (inviato a Manager per display). */
const KSCORM_ECO_ROLE_MAP = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'EDITOR',
  VIEWER: 'VIEWER',
} as const;

/** Provisioning kit restituito da Manager al self-register (200). */
interface ProvisioningKit {
  installationId?: string;
  status?: string;
  oidc?: {
    issuer?: string;
    clientId?: string;
    authDomain?: string;
    scope?: string;
  };
  m2m?: {
    clientId?: string;
    clientSecret?: string;
    tokenUrl?: string;
    scope?: string;
  };
  settings?: {
    enforce?: unknown;
    walletEnabled?: unknown;
  };
}

/**
 * Onboarding ad attrito zero (lato prodotto). Al primo avvio l'installazione si
 * annuncia a Manager (`POST /installations/self`) autenticandosi con la propria
 * **workload identity** (richiesta `sts:GetCallerIdentity` pre-firmata SigV4 nel
 * body, nessuna credenziale statica). Manager:
 *  - 202 `pending_approval` → in attesa che un operatore approvi l'ARN: il
 *    prodotto RITENTA in background, senza bloccare il boot;
 *  - 200 + provisioning kit → il prodotto PERSISTE il kit (config OIDC + id M2M
 *    nel DB; secret M2M in Secrets Manager) e applica le settings.
 *
 * Dopo il provisioning, gate/wallet usano il kit persistito; l'audience OIDC è
 * risolta a runtime da qui, non da config statica. Idempotente e non bloccante.
 *
 * Tutto gated da `ECOSYSTEM_SELF_REGISTER=true`. Vedi
 * docs/ECOSYSTEM-ZEROTOUCH-ONBOARDING.md per il contratto completo.
 */
@Injectable()
export class EcosystemProvisioningService implements OnModuleInit {
  private readonly logger = new Logger(EcosystemProvisioningService.name);
  private readonly cfg: AppConfig['ecosystem'];
  private readonly secrets: SecretsManagerClient;
  private retryTimer?: NodeJS.Timeout;

  /** Intervallo di retry quando siamo in `pending_approval` (ms). */
  private static readonly RETRY_MS = 60_000;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
    private readonly settings: EcosystemSettingsService,
    private readonly credentials: EcosystemCredentialsService,
  ) {
    this.cfg = config.get('ecosystem', { infer: true });
    this.secrets = new SecretsManagerClient({ region: this.cfg.installationRegion });
  }

  async onModuleInit(): Promise<void> {
    if (!this.cfg.selfRegisterEnabled) return;
    if (!this.cfg.managerUrl) {
      this.logger.warn('Self-register abilitato ma MANAGER_URL assente: salto onboarding');
      return;
    }
    // Se già provisionati, carica il kit persistito nelle settings runtime e basta.
    const existing = await this.loadPersisted();
    if (existing?.status === 'provisioned') {
      this.applySettings(existing.enforce, existing.walletEnabled);
      this.logger.log('Installazione già provisionata: kit caricato dal DB');
      return;
    }
    // Non blocca il boot: avvia il tentativo in background.
    void this.attempt();
  }

  /** Un tentativo di self-register workload-auth; schedula un retry su 202. */
  private async attempt(): Promise<void> {
    try {
      const stsRequest = await buildSignedStsRequest(this.cfg.installationRegion);
      const res = await fetch(`${this.base()}/installations/self`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          product: this.cfg.productKey,
          installationId: this.cfg.installationId,
          region: this.cfg.installationRegion,
          domains: this.cfg.installationDomains,
          ecoRoleMap: KSCORM_ECO_ROLE_MAP,
          stsRequest,
        }),
        signal: AbortSignal.timeout(this.cfg.httpTimeoutMs),
      });

      if (res.status === 202) {
        this.logger.log('Self-register: 202 pending_approval — in attesa di approvazione, ritento');
        this.scheduleRetry();
        return;
      }
      if (res.status === 200) {
        const kit = (await res.json()) as ProvisioningKit;
        await this.persistKit(kit);
        this.logger.log(
          `Self-register ok: provisioning kit ricevuto e persistito (installation=${this.cfg.installationId})`,
        );
        return;
      }
      // Altri status: logga (senza corpo, può contenere dettagli) e ritenta.
      this.logger.warn(`Self-register: HTTP ${res.status} inatteso, ritento più tardi`);
      this.scheduleRetry();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Self-register non riuscito: ${reason} — ritento più tardi`);
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.attempt();
    }, EcosystemProvisioningService.RETRY_MS);
    // Non trattenere il processo in uscita per via del timer.
    this.retryTimer.unref?.();
  }

  /** Persiste il kit: secret M2M in Secrets Manager, resto nel DB. */
  private async persistKit(kit: ProvisioningKit): Promise<void> {
    let m2mSecretArn: string | undefined;
    if (kit.m2m?.clientSecret) {
      m2mSecretArn = await this.storeM2mSecret(kit.m2m.clientSecret);
    }
    const enforce = this.normalizeEnforce(kit.settings?.enforce);
    const walletEnabled = kit.settings?.walletEnabled === true;

    await this.prisma.ecosystemInstallation.upsert({
      where: { id: INSTALLATION_ROW_ID },
      create: {
        id: INSTALLATION_ROW_ID,
        installationId: this.cfg.installationId,
        productKey: this.cfg.productKey,
        oidcIssuer: kit.oidc?.issuer,
        oidcClientId: kit.oidc?.clientId,
        oidcAuthDomain: kit.oidc?.authDomain,
        oidcScope: kit.oidc?.scope,
        m2mClientId: kit.m2m?.clientId,
        m2mSecretArn,
        enforce,
        walletEnabled,
        status: 'provisioned',
        lastKitAt: new Date(),
      },
      update: {
        oidcIssuer: kit.oidc?.issuer,
        oidcClientId: kit.oidc?.clientId,
        oidcAuthDomain: kit.oidc?.authDomain,
        oidcScope: kit.oidc?.scope,
        m2mClientId: kit.m2m?.clientId,
        // Non sovrascrivere l'ARN se questo giro non ha restituito un secret
        // (idempotente: Manager mostra il secret solo alla creazione/rotazione).
        ...(m2mSecretArn ? { m2mSecretArn } : {}),
        enforce,
        walletEnabled,
        status: 'provisioned',
        lastKitAt: new Date(),
      },
    });

    this.applySettings(enforce, walletEnabled);
    // Le credenziali M2M sono cambiate (nuovo kit): invalida la cache così gate
    // e wallet usano subito le nuove, senza aspettare la scadenza.
    this.credentials.invalidate();
  }

  /** Scrive il secret M2M in Secrets Manager (crea o aggiorna) e ritorna l'ARN. */
  private async storeM2mSecret(secret: string): Promise<string> {
    const name = `${this.cfg.productKey}/MANAGER_M2M_CLIENT_SECRET`;
    try {
      const out = await this.secrets.send(
        new PutSecretValueCommand({ SecretId: name, SecretString: secret }),
      );
      return out.ARN as string;
    } catch (err) {
      if (err instanceof ResourceNotFoundException) {
        const out = await this.secrets.send(
          new CreateSecretCommand({ Name: name, SecretString: secret }),
        );
        return out.ARN as string;
      }
      throw err;
    }
  }

  private applySettings(enforce: string | null | undefined, walletEnabled: boolean): void {
    this.settings.applyFromManager({ enforce: enforce ?? undefined, walletEnabled });
  }

  private normalizeEnforce(value: unknown): string | undefined {
    return value === 'off' || value === 'soft' || value === 'hard' ? value : undefined;
  }

  private async loadPersisted() {
    return this.prisma.ecosystemInstallation.findUnique({ where: { id: INSTALLATION_ROW_ID } });
  }

  private base(): string {
    return (this.cfg.managerUrl ?? '').replace(/\/+$/, '');
  }
}
