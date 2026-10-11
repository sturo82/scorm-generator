import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Credenziali M2M effettive (client_id + secret) con cui chiamare Manager. */
export interface M2mCredentials {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  scopes: string;
}

/**
 * Fonte unica delle credenziali M2M. Ordine di precedenza:
 *  1. **Provisioning kit persistito** (onboarding zero-touch): client_id dal DB
 *     (EcosystemInstallation), secret da Secrets Manager (ARN nel DB). È il caso
 *     di regime: il prodotto ha ottenuto le credenziali auto-provisionandosi.
 *  2. **Config statica (env)**: `MANAGER_M2M_CLIENT_ID/SECRET` + token url/scope.
 *     Fallback per modalità manuale/transizione o test, quando non c'è ancora un
 *     kit persistito.
 *
 * Separare "da dove vengono le credenziali" da "come si usano" tiene token e
 * http service indipendenti dalla sorgente (kit vs env).
 */
@Injectable()
export class EcosystemCredentialsService {
  private readonly logger = new Logger(EcosystemCredentialsService.name);
  private readonly cfg: AppConfig['ecosystem'];
  private readonly secrets: SecretsManagerClient;
  /** Cache breve del secret risolto da Secrets Manager (evita fetch a ogni token). */
  private cached?: { creds: M2mCredentials; expiresAtMs: number };
  private static readonly CACHE_MS = 300_000;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
  ) {
    this.cfg = config.get('ecosystem', { infer: true });
    this.secrets = new SecretsManagerClient({ region: this.cfg.installationRegion });
  }

  /** Invalida la cache (es. dopo rotazione del secret). */
  invalidate(): void {
    this.cached = undefined;
  }

  /**
   * Ritorna le credenziali M2M effettive, o null se non disponibili (né kit né
   * env). Preferisce il kit persistito; cache breve.
   */
  async resolve(): Promise<M2mCredentials | null> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAtMs > now) return this.cached.creds;

    const fromKit = await this.fromPersistedKit();
    const creds = fromKit ?? this.fromEnv();
    if (!creds) return null;

    this.cached = { creds, expiresAtMs: now + EcosystemCredentialsService.CACHE_MS };
    return creds;
  }

  /** True se esiste almeno una sorgente di credenziali configurata. */
  async isConfigured(): Promise<boolean> {
    return (await this.resolve()) !== null;
  }

  /**
   * Audience OIDC effettiva (client web del prodotto) risolta a RUNTIME: dal kit
   * persistito se presente, altrimenti dall'env `OIDC_AUDIENCE` di fallback.
   * Null se nessuna delle due è nota (es. non ancora provisionati). Usata dalla
   * validazione token: in zero-touch l'audience non è nota al deploy.
   */
  async getOidcAudience(): Promise<string | null> {
    const row = await this.prisma.ecosystemInstallation.findUnique({ where: { id: 'self' } });
    if (row?.oidcClientId) return row.oidcClientId;
    return process.env['OIDC_AUDIENCE'] ?? null;
  }

  private async fromPersistedKit(): Promise<M2mCredentials | null> {
    const row = await this.prisma.ecosystemInstallation.findUnique({ where: { id: 'self' } });
    if (!row?.m2mClientId || !row.m2mSecretArn) return null;
    let clientSecret: string;
    try {
      const out = await this.secrets.send(
        new GetSecretValueCommand({ SecretId: row.m2mSecretArn }),
      );
      if (!out.SecretString) return null;
      clientSecret = out.SecretString;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Secret M2M non leggibile da Secrets Manager: ${reason}`);
      return null;
    }
    return {
      clientId: row.m2mClientId,
      clientSecret,
      tokenUrl: this.cfg.tokenUrl ?? 'https://auth.knowkube.com/oauth2/token',
      scopes: this.cfg.scopes,
    };
  }

  private fromEnv(): M2mCredentials | null {
    if (!this.cfg.tokenUrl || !this.cfg.m2mClientId || !this.cfg.m2mClientSecret) return null;
    return {
      clientId: this.cfg.m2mClientId,
      clientSecret: this.cfg.m2mClientSecret,
      tokenUrl: this.cfg.tokenUrl,
      scopes: this.cfg.scopes,
    };
  }
}
