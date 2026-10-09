import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import type { AppConfig } from '../config/configuration.js';

/**
 * Claim di un access token UTENTE emesso dal redeem SSO. `kind: 'user'` lo
 * distingue dai token di servizio (kind: 'service') dell'integrazione M2M.
 */
export interface UserTokenClaims {
  /** Subject = externalId dell'utente (stabile per tenant). */
  sub: string;
  tenantId: string;
  email?: string;
  kind: 'user';
}

/**
 * Firma/verifica dei token utente emessi dall'SSO. Chiave DEDICATA
 * (SSO_USER_JWT_SECRET), separata sia dall'auth utente OIDC sia dai token di
 * servizio: ogni canale ha la propria chiave e il proprio issuer/audience.
 */
@Injectable()
export class UserTokenService {
  private readonly cfg: AppConfig['sso'];

  constructor(config: ConfigService<AppConfig, true>) {
    this.cfg = config.get('sso', { infer: true });
  }

  /** Firma un access token utente (sessione web app). */
  sign(input: { externalId: string; tenantId: string; email?: string }): {
    accessToken: string;
    expiresInSec: number;
  } {
    const expiresInSec = this.cfg.userTokenTtlSec;
    const accessToken = jwt.sign(
      {
        tenantId: input.tenantId,
        kind: 'user',
        ...(input.email ? { email: input.email } : {}),
      },
      this.cfg.userJwtSecret,
      {
        subject: input.externalId,
        issuer: this.cfg.issuer,
        audience: this.cfg.audience,
        algorithm: 'HS256',
        expiresIn: expiresInSec,
      },
    );
    return { accessToken, expiresInSec };
  }

  /** Verifica firma/issuer/audience/scadenza e ritorna i claim utente. */
  verify(token: string): UserTokenClaims {
    const decoded = jwt.verify(token, this.cfg.userJwtSecret, {
      issuer: this.cfg.issuer,
      audience: this.cfg.audience,
      algorithms: ['HS256'],
    });
    if (typeof decoded === 'string') {
      throw new Error('Token utente non valido: payload non strutturato');
    }
    const payload = decoded as jwt.JwtPayload & Record<string, unknown>;
    if (payload.kind !== 'user') {
      throw new Error('Token non utente (claim kind mancante o errato)');
    }
    const sub = payload.sub;
    const tenantId = payload.tenantId;
    if (typeof sub !== 'string' || typeof tenantId !== 'string') {
      throw new Error('Token utente privo di subject/tenant');
    }
    return {
      sub,
      tenantId,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      kind: 'user',
    };
  }
}
