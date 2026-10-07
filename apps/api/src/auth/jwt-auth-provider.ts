import jwt from 'jsonwebtoken';
import type { AuthProvider, VerifiedClaims } from './auth-provider.js';

export interface JwtAuthProviderOptions {
  secret: string;
  issuer: string;
  audience: string;
  /** Nome del claim che contiene il tenantId (default: "tenant_id"). */
  tenantClaim?: string;
}

/**
 * Provider di autenticazione JWT (HS256) per sviluppo e test. Verifica firma,
 * issuer, audience e scadenza. In produzione va sostituito da un provider OIDC
 * che valida i token di un IdP (chiavi JWKS), registrabile sulla stessa
 * astrazione AuthProvider senza modifiche al dominio (Requisito 10.3).
 */
export class JwtAuthProvider implements AuthProvider {
  readonly id = 'jwt';
  private readonly tenantClaim: string;

  constructor(private readonly options: JwtAuthProviderOptions) {
    this.tenantClaim = options.tenantClaim ?? 'tenant_id';
  }

  async verify(token: string): Promise<VerifiedClaims> {
    const decoded = jwt.verify(token, this.options.secret, {
      issuer: this.options.issuer,
      audience: this.options.audience,
      algorithms: ['HS256'],
    });

    if (typeof decoded === 'string') {
      throw new Error('Token JWT non valido: payload non strutturato');
    }

    const payload = decoded as jwt.JwtPayload & Record<string, unknown>;
    const subject = payload.sub;
    const tenantId = payload[this.tenantClaim];

    if (typeof subject !== 'string' || subject.length === 0) {
      throw new Error('Token JWT privo di subject (sub)');
    }
    if (typeof tenantId !== 'string' || tenantId.length === 0) {
      throw new Error(`Token JWT privo del claim tenant (${this.tenantClaim})`);
    }

    return {
      subject,
      tenantId,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      raw: payload,
    };
  }

  /** Helper per generare token in sviluppo/test (NON per produzione). */
  sign(claims: {
    subject: string;
    tenantId: string;
    email?: string;
    expiresInSec?: number;
  }): string {
    return jwt.sign(
      {
        [this.tenantClaim]: claims.tenantId,
        ...(claims.email ? { email: claims.email } : {}),
      },
      this.options.secret,
      {
        subject: claims.subject,
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithm: 'HS256',
        expiresIn: claims.expiresInSec ?? 3600,
      },
    );
  }
}
