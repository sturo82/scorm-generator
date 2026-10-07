import type { AuthProvider, VerifiedClaims } from './auth-provider.js';

export interface DevAuthProviderOptions {
  tenantId: string;
  subject: string;
  email: string;
}

/**
 * Provider di autenticazione per sviluppo: accetta un token statico "dev-token"
 * e restituisce claim fissi, così il frontend può lavorare contro l'API vera
 * senza un IdP. SOLO per ambienti di sviluppo (AUTH_PROVIDER=dev). In produzione
 * si usa jwt o oidc.
 */
export class DevAuthProvider implements AuthProvider {
  readonly id = 'dev';
  constructor(private readonly opts: DevAuthProviderOptions) {}

  async verify(token: string): Promise<VerifiedClaims> {
    if (token !== 'dev-token') {
      throw new Error('Token dev non valido');
    }
    return {
      subject: this.opts.subject,
      tenantId: this.opts.tenantId,
      email: this.opts.email,
      raw: { dev: true },
    };
  }
}
