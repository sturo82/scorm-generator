import { Injectable } from '@nestjs/common';
import {
  computeQuote,
  type CourseCostSummary,
  type CostLine,
  type PricingQuote,
  type PricingQuoteInput,
  type MeterProvider,
  type MeterUnit,
} from '@scorm/contracts';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Lettura/aggregazione dei costi misurati e calcolo del preventivo cliente.
 * Il consuntivo di un corso è la somma degli UsageRecord, raggruppati per
 * sorgente/provider/unità per il breakdown nel pannello costi.
 */
@Injectable()
export class CostService {
  constructor(private readonly prisma: PrismaService) {}

  /** Riepilogo costi consuntivi di un corso (somma UsageRecord). */
  async courseCostSummary(tenantId: string, courseId: string): Promise<CourseCostSummary> {
    const records = await this.prisma.usageRecord.findMany({
      where: { tenantId, courseId },
      select: {
        source: true,
        provider: true,
        unit: true,
        quantity: true,
        costUsd: true,
        createdAt: true,
      },
    });

    // Raggruppa per (source, provider, unit).
    const byKey = new Map<string, CostLine>();
    let providerCostUsd = 0;
    let lastUsageAt: Date | null = null;
    for (const r of records) {
      const key = `${r.source}|${r.provider}|${r.unit}`;
      const cost = Number(r.costUsd);
      providerCostUsd += cost;
      if (!lastUsageAt || r.createdAt > lastUsageAt) lastUsageAt = r.createdAt;
      const line = byKey.get(key);
      if (line) {
        line.quantity += r.quantity;
        line.calls += 1;
        line.costUsd += cost;
      } else {
        byKey.set(key, {
          source: r.source,
          provider: r.provider as MeterProvider,
          unit: r.unit as MeterUnit,
          quantity: r.quantity,
          calls: 1,
          costUsd: cost,
        });
      }
    }

    const lines = [...byKey.values()].sort((a, b) => b.costUsd - a.costUsd);
    return {
      courseId,
      providerCostUsd,
      lines,
      totalCalls: records.length,
      lastUsageAt: lastUsageAt ? lastUsageAt.toISOString() : null,
    };
  }

  /** Preventivo cliente a partire dal costo consuntivo del corso. */
  async courseQuote(
    tenantId: string,
    courseId: string,
    input: PricingQuoteInput,
  ): Promise<PricingQuote & { summary: CourseCostSummary }> {
    const summary = await this.courseCostSummary(tenantId, courseId);
    const quote = computeQuote(summary.providerCostUsd, input);
    return { ...quote, summary };
  }
}
