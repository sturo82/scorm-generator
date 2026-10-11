import { Injectable, Logger } from '@nestjs/common';
import { EcosystemCredentialsService } from './ecosystem-credentials.service.js';

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
 * Le credenziali M2M arrivano da EcosystemCredentialsService (kit persistito o
 * env). Nessuna credenziale finisce nei log: in caso d'errore si logga solo lo
 * stato HTTP.
 */
@Injectable()
export class EcosystemTokenService {
  private readonly logger = new Logger(EcosystemTokenService.name);

  /** Token corrente in cache + istante (ms epoch) di scadenza effettiva. */
  private cached?: { accessToken: string; expiresAtMs: number };
  /** Promise in volo per deduplicare richieste concorrenti del token. */
  private inflight?: Promise<string>;

  /** Secondi di anticipo con cui consideriamo il token "scaduto". */
  private static readonly EXPIRY_SKEW_SEC = 30;
  /** Timeout (ms) della chiamata al token endpoint. */
  private static readonly TIMEOUT_MS = 5000;

  constructor(private readonly credentials: EcosystemCredentialsService) {}

  /** True se esistono credenziali M2M (kit persistito o env). */
  async isConfigured(): Promise<boolean> {
    return this.credentials.isConfigured();
  }

  /**
   * Ritorna un access token valido, dalla cache se possibile. Lancia se non ci
   * sono credenziali o il token endpoint fallisce.
   */
  async getToken(): Promise<string> {
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

  /** Invalida la cache del token (usato in caso di 401 per forzare un refresh). */
  invalidate(): void {
    this.cached = undefined;
  }

  private async fetchToken(): Promise<string> {
    const creds = await this.credentials.resolve();
    if (!creds) {
      throw new Error('Ecosystem M2M non configurato (nessun kit persistito né env)');
    }
    const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: creds.scopes,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EcosystemTokenService.TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(creds.tokenUrl, {
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
    this.logger.log(`Token M2M ecosistema ottenuto (scadenza ~${data.expires_in}s)`);
    return data.access_token;
  }
}
