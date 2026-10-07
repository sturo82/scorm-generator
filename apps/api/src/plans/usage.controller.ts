import { Controller, Get } from '@nestjs/common';
import { QuotaResource } from '@scorm/contracts';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { QuotaService, type QuotaStatus } from './quota.service.js';

/**
 * Espone il consumo corrente rispetto ai limiti del piano (Requisito 11.4).
 */
@Controller('usage')
export class UsageController {
  constructor(private readonly quota: QuotaService) {}

  @Get()
  async current(@CurrentContext() ctx: AuthContext): Promise<{
    featureFlags: Record<string, boolean | undefined>;
    quotas: QuotaStatus[];
  }> {
    const resources = QuotaResource.options;
    const quotas = await Promise.all(
      resources.map((r) => this.quota.getStatus(ctx.tenant.tenantId, r)),
    );
    const featureFlags = await this.quota.getFeatureFlags(ctx.tenant.tenantId);
    return { featureFlags, quotas };
  }
}
