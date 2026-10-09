import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { SsoModule } from '../sso/sso.module.js';
import { AUTH_PROVIDER } from './auth-provider.js';
import { JwtAuthProvider } from './jwt-auth-provider.js';
import { DevAuthProvider } from './dev-auth-provider.js';
import { OidcAuthProvider } from './oidc-auth-provider.js';
import { AuthGuard } from './auth.guard.js';
import { RolesGuard } from './roles.guard.js';

/**
 * Modulo di autenticazione. Seleziona il provider in base alla configurazione
 * (Requisito 10.4) e registra AuthGuard come guard globale, così tutte le rotte
 * sono protette per default (opt-out con @Public()).
 */
@Global()
@Module({
  imports: [SsoModule],
  providers: [
    {
      provide: AUTH_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const auth = config.get('auth', { infer: true });
        switch (auth.provider) {
          case 'jwt':
            return new JwtAuthProvider({
              secret: auth.jwtSecret,
              issuer: auth.jwtIssuer,
              audience: auth.jwtAudience,
            });
          case 'dev':
            return new DevAuthProvider({
              tenantId: 'tenant-dev',
              subject: 'subdev',
              email: 'owner@acme.test',
            });
          case 'oidc': {
            if (!auth.oidcIssuer) {
              throw new Error('Provider OIDC selezionato ma OIDC_ISSUER non configurato');
            }
            // Il JWKS può essere derivato dall'issuer (standard OIDC / Cognito):
            // <issuer>/.well-known/jwks.json. Override esplicito via OIDC_JWKS_URI.
            const jwksUri =
              auth.oidcJwksUri ?? `${auth.oidcIssuer.replace(/\/$/, '')}/.well-known/jwks.json`;
            const tenantClaim = auth.oidcTenantClaim
              ? auth.oidcTenantClaim.split(',').map((c) => c.trim()).filter(Boolean)
              : undefined;
            return new OidcAuthProvider({
              issuer: auth.oidcIssuer,
              audience: auth.oidcAudience,
              jwksUri,
              tenantClaim,
              expectedTokenUse: auth.oidcTokenUse,
            });
          }
          default:
            throw new Error(`Provider di autenticazione non supportato: ${auth.provider}`);
        }
      },
    },
    // Ordine di registrazione = ordine di esecuzione: prima autentica, poi
    // autorizza per ruolo.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AUTH_PROVIDER],
})
export class AuthModule {}
