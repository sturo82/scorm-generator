import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { EcosystemTokenService } from './ecosystem-token.service.js';

/** Errore di trasporto verso Manager (rete/timeout/HTTP non 2xx). */
export class EcosystemRequestError extends Error {
  constructor(
    readonly status: number | undefined,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'EcosystemRequestError';
  }
}

/**
 * Client HTTP sottile verso l'API d'ecosistema di Manager. Allega
 * automaticamente il Bearer M2M, applica timeout e, su 401, rinnova il token
 * una volta (gestisce la rotazione/scadenza lato Cognito). Non espone segreti.
 */
@Injectable()
export class EcosystemHttpService {
  private readonly logger = new Logger(EcosystemHttpService.name);
  private readonly cfg: AppConfig['ecosystem'];

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly tokens: EcosystemTokenService,
  ) {
    this.cfg = config.get('ecosystem', { infer: true });
  }

  /** True se è noto l'URL base di Manager e ci sono credenziali M2M (kit o env). */
  async isConfigured(): Promise<boolean> {
    return Boolean(this.cfg.managerUrl) && (await this.tokens.isConfigured());
  }

  async get<T>(path: string, query?: Record<string, string>): Promise<T> {
    const url = this.buildUrl(path, query);
    return this.request<T>('GET', url);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const url = this.buildUrl(path);
    return this.request<T>('POST', url, body);
  }

  private buildUrl(path: string, query?: Record<string, string>): string {
    const base = (this.cfg.managerUrl ?? '').replace(/\/+$/, '');
    const rel = path.replace(/^\/+/, '');
    const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
    return `${base}/${rel}${qs}`;
  }

  private async request<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
    if (!(await this.isConfigured())) {
      throw new EcosystemRequestError(undefined, 'Ecosystem non configurato');
    }
    // Primo tentativo con token in cache; su 401 rinnova e riprova una volta.
    let res = await this.send(method, url, body, await this.tokens.getToken());
    if (res.status === 401) {
      this.tokens.invalidate();
      res = await this.send(method, url, body, await this.tokens.getToken());
    }

    const text = await res.text();
    const parsed = text ? safeJson(text) : undefined;
    if (!res.ok) {
      this.logger.warn(`Manager ${method} ${redactUrl(url)} → HTTP ${res.status}`);
      throw new EcosystemRequestError(res.status, `Manager HTTP ${res.status}`, parsed);
    }
    return parsed as T;
  }

  private async send(
    method: string,
    url: string,
    body: unknown,
    token: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.cfg.httpTimeoutMs);
    try {
      return await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new EcosystemRequestError(undefined, `Manager irraggiungibile: ${reason}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Rimuove query string dagli URL nei log (può contenere company_id/reference). */
function redactUrl(url: string): string {
  const idx = url.indexOf('?');
  return idx === -1 ? url : url.slice(0, idx);
}
