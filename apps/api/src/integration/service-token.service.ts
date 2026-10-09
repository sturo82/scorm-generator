import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import type { AppConfig } from '../config/configuration.js';

const scrypt = promisify(scryptCb);

/** Lunghezza (byte) della chiave derivata scrypt. */
const SCRYPT_KEYLEN = 32;

/**
 * Claim di un access token di servizio emesso dal flusso client-credentials.
 * `kind: 'service'` lo distingue inequivocabilmente dai token utente, così un
 * token di servizio non può essere scambiato per una credenziale di persona.
 */
export interface ServiceTokenClaims {
  /** Subject = clientId pubblico dell'IntegrationClient. */
  sub: string;
  tenantId: string;
  scopes: string[];
  kind: 'service';
}

/**
 * Firma/verifica dei token di servizio (JWT HS256) e gestione delle credenziali
 * client (clientId pubblico + hash del clientSecret).
 *
 * I token di servizio usano una chiave DEDICATA (INTEGRATION_JWT_SECRET),
 * separata dall'auth utente: compromettere l'una non intacca l'altra, e un
 * token di servizio non è accettato dai provider di auth utente (issuer/audience
 * diversi + claim `kind`).
 */
@Injectable()
export class ServiceTokenService {
  private readonly cfg: AppConfig['integration'];

  constructor(config: ConfigService<AppConfig, true>) {
    this.cfg = config.get('integration', { infer: true });
  }

  /** Genera un clientId pubblico opaco (prefissato per riconoscibilità). */
  generateClientId(): string {
    return `oc_${randomBytes(18).toString('base64url')}`;
  }

  /** Genera un clientSecret ad alta entropia (mostrato una sola volta). */
  generateClientSecret(): string {
    return `os_${randomBytes(32).toString('base64url')}`;
  }

  /** Deriva l'hash del secret (scrypt) con salt casuale per record. */
  async hashSecret(secret: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = (await scrypt(secret, salt, SCRYPT_KEYLEN)) as Buffer;
    return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
  }

  /** Verifica un secret contro l'hash salvato, in tempo costante. */
  async verifySecret(secret: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    const [scheme, saltB64, hashB64] = parts;
    if (parts.length !== 3 || scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = (await scrypt(secret, salt, expected.length)) as Buffer;
    // timingSafeEqual richiede lunghezze uguali: la derivazione usa la stessa.
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  }

  /** Firma un access token di servizio con gli scopi concessi. */
  sign(input: { clientId: string; tenantId: string; scopes: string[] }): {
    accessToken: string;
    expiresInSec: number;
  } {
    const expiresInSec = this.cfg.tokenTtlSec;
    const accessToken = jwt.sign(
      { tenantId: input.tenantId, scopes: input.scopes, kind: 'service' },
      this.cfg.jwtSecret,
      {
        subject: input.clientId,
        issuer: this.cfg.issuer,
        audience: this.cfg.audience,
        algorithm: 'HS256',
        expiresIn: expiresInSec,
      },
    );
    return { accessToken, expiresInSec };
  }

  /** Verifica firma/issuer/audience/scadenza e ritorna i claim di servizio. */
  verify(token: string): ServiceTokenClaims {
    const decoded = jwt.verify(token, this.cfg.jwtSecret, {
      issuer: this.cfg.issuer,
      audience: this.cfg.audience,
      algorithms: ['HS256'],
    });
    if (typeof decoded === 'string') {
      throw new Error('Token di servizio non valido: payload non strutturato');
    }
    const payload = decoded as jwt.JwtPayload & Record<string, unknown>;
    if (payload.kind !== 'service') {
      throw new Error('Token non di servizio (claim kind mancante o errato)');
    }
    const sub = payload.sub;
    const tenantId = payload.tenantId;
    const scopes = payload.scopes;
    if (typeof sub !== 'string' || typeof tenantId !== 'string') {
      throw new Error('Token di servizio privo di subject/tenant');
    }
    return {
      sub,
      tenantId,
      scopes: Array.isArray(scopes) ? (scopes as string[]) : [],
      kind: 'service',
    };
  }
}
