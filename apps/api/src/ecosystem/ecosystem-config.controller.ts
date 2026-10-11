import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public } from '../auth/public.decorator.js';

/**
 * Config OIDC pubblica servita al WEB a runtime (non build-time). Nell'onboarding
 * zero-touch il client web OIDC è creato da Manager e noto solo dopo il
 * provisioning: il frontend non può avere l'id a build-time, quindi lo legge da
 * qui all'avvio. Finché non si è provisionati, i campi possono essere assenti.
 *
 * Pubblica (nessun auth): espone solo identificatori NON segreti (issuer,
 * clientId pubblico, authDomain, scope). Nessun secret.
 */
@Controller('ecosystem')
export class EcosystemConfigController {
  private readonly cfg: AppConfig['ecosystem'];

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
  ) {
    this.cfg = config.get('ecosystem', { infer: true });
  }

  @Public()
  @Get('oidc-config')
  async oidcConfig(): Promise<{
    issuer: string | null;
    clientId: string | null;
    authDomain: string | null;
    scope: string;
    provisioned: boolean;
  }> {
    const row = await this.prisma.ecosystemInstallation.findUnique({ where: { id: 'self' } });
    const provisioned = row?.status === 'provisioned';
    return {
      // Precedenza al kit persistito; fallback su env (modalità manuale).
      issuer: row?.oidcIssuer ?? process.env['OIDC_ISSUER'] ?? null,
      clientId: row?.oidcClientId ?? process.env['OIDC_AUDIENCE'] ?? null,
      authDomain: row?.oidcAuthDomain ?? process.env['OIDC_AUTH_DOMAIN'] ?? null,
      scope: row?.oidcScope ?? 'openid email profile',
      provisioned,
    };
  }
}
