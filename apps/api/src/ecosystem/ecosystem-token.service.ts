import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';

/** Risposta minima dell'endpoint token OAuth2 (client-credentials). */
interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

/**
 * Ottiene e mette in cache l'access token M2M (OAuth2 client-credentials) per
 * chiamare l'API d'ecosistema di Manager. Il token è condiviso a livello di
 * processo e rinnovato poco prima della scadenza (skew di sicurezza), così le
 * chiamate verso Manager non pagano un round-trip al token endpoint ogni volta.
 *
 * Nessuna credenziale finisce nei log: in caso d'errore si logga solo lo stato.
 */
@Injectable()
export class EcosystemTokenService {
  private readonly logger = new Logger(EcosystemTokenService.name);
  private readonly cfg: AppConfig['ecosystem'];

  /** Token corrente in cache + istante (ms epoch) di scadenza effettiva. */
  private cached?: { accessToken: string; expiresAtMs: number };
  /** Promise in volo per deduplicare richieste concorrenti del token. */
  private inflight?: Promise<string>;

  /** Secondi di anticipo con cui consideriamo il token "scaduto". */
  private static readonly EXPIRY_SKEW_SEC = 30;

  constructor(config: ConfigService<AppConfig, true>) {
    this.cfg = config.get('ecosystem', { infer: true });
  }

  /** True se la configurazione M2M è completa (token endpoint + credenziali). */
  isConfigured(): boolean {
    return Boolean(this.cfg.tokenUrl && this.cfg.m2mClientId && this.cfg.m2mClientSecret);
  }

  /**
   * Ritorna un access token valido, dalla cache se possibile. Lancia se la
   * configurazione è incompleta o il token endpoint fallisce.
   */
  async getToken(): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('Ecosystem M2M non configurato (tokenUrl/clientId/clientSecret mancanti)');
    }
    const now = Date.now();
    if (this.cached && this.cached.expiresAtMs > now) {
      return this.cached.accessToken;
    }
    // Deduplica richieste concorrenti: una sola chiamata al token endpoint.
    if (!this.inflight) {
      this.inflight = this.fetchToken().finally(() => {
        this.inflight = undefined;
      });
    }
    return this.inflight;
  }

  /** Invalida la cache (usato in caso di 401 per forzare un refresh). */
  invalidate(): void {
    this.cached = undefined;
  }

  private async fetchToken(): Promise<string> {
    const basic = Buffer.from(
      `${this.cfg.m2mClientId}:${this.cfg.m2mClientSecret}`,
    ).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: this.cfg.scopes,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.cfg.httpTimeoutMs);
    let res: Response;
    try {
      res = await fetch(this.cfg.tokenUrl as string, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      // Non logghiamo il corpo per evitare di esporre dettagli delle credenziali.
      this.logger.error(`Token endpoint ecosistema ha risposto ${res.status}`);
      throw new Error(`Token endpoint ecosistema: HTTP ${res.status}`);
    }

    const data = (await res.json()) as TokenResponse;
    if (!data.access_token || typeof data.expires_in !== 'number') {
      throw new Error('Risposta token endpoint ecosistema malformata');
    }

    const expiresAtMs =
      Date.now() + Math.max(0, data.expires_in - EcosystemTokenService.EXPIRY_SKEW_SEC) * 1000;
    this.cached = { accessToken: data.access_token, expiresAtMs };
    this.logger.log(
      `Token M2M ecosistema ottenuto (scadenza ~${data.expires_in}s, scope: ${data.scope ?? this.cfg.scopes})`,
    );
    return data.access_token;
  }
}
