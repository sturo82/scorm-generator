import { Injectable, NotFoundException } from '@nestjs/common';
import {
  FeatureFlags,
  PlanLimits,
  QUOTA_LIMIT_KEY,
  type QuotaResource,
} from '@scorm/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { QuotaExceededException } from './quota.exception.js';

export interface QuotaStatus {
  resource: QuotaResource;
  /** Limite del piano; null = illimitato. */
  limit: number | null;
  current: number;
  /** Rimanente; null = illimitato. */
  remaining: number | null;
}

/**
 * Gestione di piani, quote e feature flag (Requisito 1.4 / 1.5 / 11.4).
 * Legge il Plan del tenant, calcola il consumo corrente per risorsa, applica i
 * limiti con messaggi chiari ed espone il consumo.
 */
@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Carica e valida i limiti del piano del tenant. */
  async getLimits(tenantId: string): Promise<PlanLimits> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: { select: { limits: true } } },
    });
    if (!tenant) throw new NotFoundException('Tenant non trovato');
    return PlanLimits.parse(tenant.plan.limits);
  }

  /** Carica e valida i feature flag del piano del tenant. */
  async getFeatureFlags(tenantId: string): Promise<FeatureFlags> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: { select: { featureFlags: true } } },
    });
    if (!tenant) throw new NotFoundException('Tenant non trovato');
    return FeatureFlags.parse(tenant.plan.featureFlags);
  }

  /** True se la feature è abilitata dal piano del tenant. */
  async isFeatureEnabled(tenantId: string, feature: keyof FeatureFlags): Promise<boolean> {
    const flags = await this.getFeatureFlags(tenantId);
    return flags[feature] === true;
  }

  /** Consumo corrente di una risorsa per il tenant. */
  async getUsage(tenantId: string, resource: QuotaResource): Promise<number> {
    switch (resource) {
      case 'courses':
        return this.prisma.course.count({ where: { tenantId } });
      case 'brands':
        return this.prisma.brand.count({ where: { tenantId } });
      case 'users':
        return this.prisma.user.count({ where: { tenantId } });
      case 'knowledgeMb': {
        const agg = await this.prisma.knowledgeDoc.aggregate({
          where: { tenantId },
          _sum: { sizeBytes: true },
        });
        const bytes = agg._sum.sizeBytes ?? 0;
        return bytes / (1024 * 1024);
      }
      case 'exportsPerMonth': {
        const start = startOfMonthUtc();
        return this.prisma.scormPackage.count({
          where: {
            createdAt: { gte: start },
            build: { course: { tenantId } },
          },
        });
      }
      default: {
        // Esaustività: se si aggiunge una risorsa senza gestirla, errore chiaro.
        const _exhaustive: never = resource;
        throw new Error(`Risorsa quota non gestita: ${String(_exhaustive)}`);
      }
    }
  }

  /** Stato quota (limite, consumo, rimanente) per una risorsa. */
  async getStatus(tenantId: string, resource: QuotaResource): Promise<QuotaStatus> {
    const limits = await this.getLimits(tenantId);
    const limit = limits[QUOTA_LIMIT_KEY[resource]];
    const current = await this.getUsage(tenantId, resource);
    return {
      resource,
      limit,
      current,
      remaining: limit === null ? null : Math.max(0, limit - current),
    };
  }

  /**
   * Verifica che l'incremento richiesto non superi il limite; in caso contrario
   * lancia QuotaExceededException. `amount` default 1.
   */
  async assertWithinLimit(
    tenantId: string,
    resource: QuotaResource,
    amount = 1,
  ): Promise<void> {
    const limits = await this.getLimits(tenantId);
    const limit = limits[QUOTA_LIMIT_KEY[resource]];
    if (limit === null) return; // illimitato
    const current = await this.getUsage(tenantId, resource);
    if (current + amount > limit) {
      throw new QuotaExceededException(resource, limit, current, amount);
    }
  }
}

/** Inizio del mese corrente in UTC, per il conteggio export mensili. */
export function startOfMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
