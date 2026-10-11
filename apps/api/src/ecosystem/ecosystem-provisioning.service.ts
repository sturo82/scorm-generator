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
import { EcosystemHttpService } from './ecosystem-http.service.js';
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
    private readonly http: EcosystemHttpService,
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
    const existing = await this.loadPersisted();
    if (existing?.status === 'provisioned') {
      // Non fidarsi del solo status: verificare che le credenziali M2M siano
      // DAVVERO risolvibili (secret leggibile da Secrets Manager). Se non lo
      // sono (es. secret mai scritto per permessi mancanti al primo giro),
      // forziamo un re-provisioning con rotazione per riottenere il secret.
      const creds = await this.credentials.resolve();
      if (creds) {
        this.applySettings(existing.enforce, existing.walletEnabled);
        this.logger.log('Installazione già provisionata: kit caricato dal DB');
        void this.refreshViaBearer();
        return;
      }
      this.logger.warn(
        'Status=provisioned ma secret M2M non risolvibile: forzo re-provisioning (rotateM2m)',
      );
      void this.attempt(true);
      return;
    }
    // Non ancora provisionati: self-register con workload-identity (SigV4), in
    // background, con retry su 202.
    void this.attempt();
  }

  /**
   * Refresh dei metadati per un'installazione GIÀ provisionata: self-register
   * via Bearer M2M (dual-auth lato Manager, giri successivi). Aggiorna card e
   * lastSeenAt, non ricrea credenziali. Best-effort: non lancia, non blocca.
   */
  private async refreshViaBearer(): Promise<void> {
    try {
      await this.http.post('installations/self', {
        product: this.cfg.productKey,
        installationId: this.cfg.installationId,
        region: this.cfg.installationRegion,
        domains: this.cfg.installationDomains,
        ecoRoleMap: KSCORM_ECO_ROLE_MAP,
        card: this.buildCard(),
      });
      this.logger.log('Self-register refresh (Bearer): metadati/card aggiornati su Manager');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Self-register refresh non riuscito: ${reason} (ignorato)`);
    }
  }

  /**
   * Un tentativo di self-register workload-auth; schedula un retry su 202.
   * `rotateM2m=true` chiede a Manager di riemettere il secret M2M (serve quando
   * siamo "provisioned" lato Manager ma non abbiamo un secret utilizzabile: il
   * secret è mostrato una volta sola, quindi senza rotazione non lo riavremmo).
   */
  private async attempt(rotateM2m = false): Promise<void> {
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
          // Card del prodotto per l'hub owner (opzionale, merge lato Manager).
          card: this.buildCard(),
          ...(rotateM2m ? { rotateM2m: true } : {}),
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
        const complete = await this.persistKit(kit);
        if (complete) {
          this.logger.log(
            `Self-register ok: provisioning kit completo persistito (installation=${this.cfg.installationId})`,
          );
          return;
        }
        // Kit senza secret M2M utilizzabile: NON siamo realmente operativi.
        // Ritentiamo chiedendo esplicitamente la rotazione del secret.
        this.logger.warn(
          'Self-register: kit senza secret M2M utilizzabile — ritento con rotateM2m per farmelo riemettere',
        );
        this.scheduleRetry(true);
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

  private scheduleRetry(rotate = false): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.attempt(rotate);
    }, EcosystemProvisioningService.RETRY_MS);
    // Non trattenere il processo in uscita per via del timer.
    this.retryTimer.unref?.();
  }

  /**
   * Persiste il kit: secret M2M in Secrets Manager, resto nel DB. Ritorna true
   * se il kit è COMPLETO, cioè abbiamo un secret M2M utilizzabile (appena
   * ricevuto o già persistito in precedenza) → status `provisioned`. Ritorna
   * false se manca il secret: salviamo i metadati ma restiamo `pending`, così il
   * caller ritenta (con rotateM2m) finché non otteniamo il secret. Non
   * marcarsi mai `provisioned` senza credenziali utilizzabili.
   */
  private async persistKit(kit: ProvisioningKit): Promise<boolean> {
    const existing = await this.loadPersisted();
    let m2mSecretArn: string | undefined;
    if (kit.m2m?.clientSecret) {
      m2mSecretArn = await this.storeM2mSecret(kit.m2m.clientSecret);
    }
    // Secret utilizzabile se arrivato ora, oppure già persistito in un ARN valido.
    const effectiveArn = m2mSecretArn ?? existing?.m2mSecretArn ?? undefined;
    const complete = Boolean(kit.m2m?.clientId && effectiveArn);
    const enforce = this.normalizeEnforce(kit.settings?.enforce);
    const walletEnabled = kit.settings?.walletEnabled === true;
    const status = complete ? 'provisioned' : 'pending';

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
        status,
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
        status,
        lastKitAt: new Date(),
      },
    });

    this.applySettings(enforce, walletEnabled);
    // Le credenziali M2M sono cambiate (nuovo kit): invalida la cache così gate
    // e wallet usano subito le nuove, senza aspettare la scadenza.
    this.credentials.invalidate();
    return complete;
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

  /**
   * Costruisce il blocco `card` per l'hub owner, includendo solo i campi
   * valorizzati (merge lato Manager, non replace). Ritorna undefined se vuoto.
   */
  private buildCard(): Record<string, string> | undefined {
    const c = this.cfg.card;
    const card: Record<string, string> = {};
    if (c.displayName) card.displayName = c.displayName;
    if (c.logoUrl) card.logoUrl = c.logoUrl;
    if (c.tagline) card.tagline = c.tagline;
    if (c.description) card.description = c.description;
    if (c.accentColor) card.accentColor = c.accentColor;
    return Object.keys(card).length > 0 ? card : undefined;
  }
}
