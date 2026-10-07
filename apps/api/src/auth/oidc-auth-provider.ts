import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { AuthProvider, VerifiedClaims } from './auth-provider.js';

export interface OidcAuthProviderOptions {
  /** Issuer dell'IdP (claim `iss` atteso). */
  issuer: string;
  /**
   * Audience attesa. Validata contro il claim `aud` e, in fallback, contro
   * `client_id`. Questo copre gli access token di Amazon Cognito, che NON hanno
   * `aud` ma espongono `client_id` (gli ID token invece usano `aud`). Se omessa,
   * la validazione dell'audience è disattivata (sconsigliato in produzione).
   */
  audience?: string;
  /** URI del JWKS dell'IdP per la verifica della firma RS256. */
  jwksUri: string;
  /**
   * Claim(s) che contengono il tenantId, provati in ordine. Default:
   * ["custom:tenant_id", "tenant_id"] così da supportare i custom attribute di
   * Cognito e i claim piatti di altri IdP (Auth0/Keycloak).
   */
  tenantClaim?: string | string[];
  /**
   * Se valorizzato, impone il claim `token_use` (Cognito: "access" | "id").
   * Utile per accettare solo l'access token ed evitare che un ID token venga
   * usato come credenziale verso l'API.
   */
  expectedTokenUse?: 'access' | 'id';
  /**
   * Resolver di chiavi alternativo (iniezione per i test). Se omesso, si usa un
   * JWKS remoto costruito da `jwksUri` con cache automatica. In produzione resta
   * sempre `undefined`.
   */
  keyResolver?: JWTVerifyGetKey;
}

const DEFAULT_TENANT_CLAIMS = ['custom:tenant_id', 'tenant_id'];

/**
 * Provider di autenticazione OIDC per la produzione (Requisito 1 / 10). Valida i
 * JWT emessi da un IdP (Cognito/Auth0/Keycloak) verificando firma (via JWKS
 * remoto), issuer, audience e scadenza con la libreria `jose`. Il set di chiavi
 * è scaricato e messo in cache automaticamente da `createRemoteJWKSet`.
 *
 * Nota Cognito: l'access token non ha il claim `aud` ma `client_id`, ed espone
 * `token_use: "access"`; i tenant sono custom attribute (`custom:tenant_id`).
 * Questo provider gestisce entrambe le forme in modo trasparente.
 */
export class OidcAuthProvider implements AuthProvider {
  readonly id = 'oidc';
  private readonly jwks: JWTVerifyGetKey;
  private readonly tenantClaims: string[];

  constructor(private readonly options: OidcAuthProviderOptions) {
    this.jwks = options.keyResolver ?? createRemoteJWKSet(new URL(options.jwksUri));
    const tc = options.tenantClaim;
    this.tenantClaims = tc ? (Array.isArray(tc) ? tc : [tc]) : DEFAULT_TENANT_CLAIMS;
  }

  async verify(token: string): Promise<VerifiedClaims> {
    // La validazione dell'audience la facciamo manualmente (vedi assertAudience)
    // perché Cognito usa `client_id` sull'access token invece di `aud`.
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.options.issuer,
    });
    this.assertAudience(payload);
    this.assertTokenUse(payload);
    return this.toClaims(payload);
  }

  private assertAudience(payload: JWTPayload & Record<string, unknown>): void {
    const expected = this.options.audience;
    if (!expected) return;
    const aud = payload.aud;
    const audMatches = Array.isArray(aud) ? aud.includes(expected) : aud === expected;
    const clientIdMatches = payload.client_id === expected;
    if (!audMatches && !clientIdMatches) {
      throw new Error('Audience del token OIDC non valida (aud/client_id)');
    }
  }

  private assertTokenUse(payload: JWTPayload & Record<string, unknown>): void {
    const expected = this.options.expectedTokenUse;
    if (!expected) return;
    if (payload.token_use !== expected) {
      throw new Error(`token_use atteso "${expected}", ricevuto "${String(payload.token_use)}"`);
    }
  }

  private toClaims(payload: JWTPayload & Record<string, unknown>): VerifiedClaims {
    const subject = payload.sub;
    if (typeof subject !== 'string' || subject.length === 0) {
      throw new Error('Token OIDC privo di subject (sub)');
    }
    const tenantId = this.resolveTenant(payload);
    if (!tenantId) {
      throw new Error(`Token OIDC privo del claim tenant (${this.tenantClaims.join(' | ')})`);
    }
    return {
      subject,
      tenantId,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      raw: payload,
    };
  }

  private resolveTenant(payload: Record<string, unknown>): string | undefined {
    for (const claim of this.tenantClaims) {
      const value = payload[claim];
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return undefined;
  }
}
