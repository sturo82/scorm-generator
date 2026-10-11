/**
 * Astrazione del provider di autenticazione (Requisito 1 / 10). Verifica un
 * token di accesso e restituisce i claim verificati. Implementazioni possibili:
 * JWT self-hosted (dev), OIDC con un IdP enterprise (Cognito/Auth0) in seguito.
 * Il dominio applicativo non dipende dall'implementazione concreta.
 */
export interface VerifiedClaims {
  /** Subject esterno (OIDC "sub"): identifica l'utente presso l'IdP. */
  subject: string;
  /** Tenant a cui appartiene il token. */
  tenantId: string;
  email?: string;
  /**
   * Ruolo d'ecosistema grezzo dal claim (`custom:eco_role`, fallback
   * `custom:role`/`role`), non ancora mappato sul ruolo interno. Usato dal JIT
   * provisioning. Undefined se assente.
   */
  ecoRole?: string;
  /** Claim grezzi, per usi futuri. */
  raw: Record<string, unknown>;
}

export interface AuthProvider {
  readonly id: string;
  /** Verifica il token; lancia se non valido/scaduto. */
  verify(token: string): Promise<VerifiedClaims>;
}

/** Token DI (NestJS) per il provider di autenticazione. */
export const AUTH_PROVIDER = 'AUTH_PROVIDER';
