import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type MeterProvider, type MeterUnit } from '@prisma/client';
import { computeCostUsd } from '@scorm/contracts';
import type { AppConfig } from '../config/configuration.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Evento di consumo emesso da un provider al termine di una chiamata pagata. */
export interface UsageEvent {
  tenantId: string;
  courseId?: string | null;
  jobId?: string | null;
  provider: MeterProvider;
  /** Model id reale usato (inference profile, image model, voce Polly). */
  model: string;
  unit: MeterUnit;
  /** Quantità consumata nell'unità (token, immagini, caratteri). */
  quantity: number;
  /** Fase sorgente per il breakdown (es. "outline", "image", "narration"). */
  source: string;
  /** Override regione; default dalla config (bedrock/media). */
  region?: string;
}

/**
 * Metering costi AI (cost-plus). Riceve un evento di consumo, risolve il prezzo
 * di listino vigente (PricingRate versionato), calcola il costo in USD e
 * persiste un UsageRecord atomico. Il costo di un corso è la SOMMA dei suoi
 * UsageRecord: si aggrega, non si sovrascrive.
 *
 * Progettato best-effort: un errore di metering (es. listino mancante) NON deve
 * mai interrompere la generazione. In quel caso logga un warning e salva
 * comunque il record con costo 0, così il consumo resta tracciato e il prezzo
 * si può ricalcolare dopo aver inserito il listino.
 */
@Injectable()
export class UsageMeterService {
  private readonly logger = new Logger(UsageMeterService.name);
  // Cache in-process dei prezzi attivi: (provider|model|unit|region) -> rate.
  // Il listino cambia di rado; si invalida al riavvio del processo.
  private readonly rateCache = new Map<
    string,
    { unitPriceUsd: number; perUnits: number } | null
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Regione di default per il lookup prezzi, in base al provider. */
  private defaultRegion(provider: MeterProvider): string {
    if (provider === 'BEDROCK_LLM') return this.config.get('bedrock', { infer: true }).region;
    if (provider === 'TRANSCRIBE') return this.config.get('transcribe', { infer: true }).region;
    return this.config.get('media', { infer: true }).region;
  }

  private cacheKey(provider: string, model: string, unit: string, region: string): string {
    return `${provider}|${model}|${unit}|${region}`;
  }

  /** Risolve il prezzo di listino vigente (validFrom più recente <= now). */
  private async resolveRate(
    provider: MeterProvider,
    model: string,
    unit: MeterUnit,
    region: string,
  ): Promise<{ unitPriceUsd: number; perUnits: number } | null> {
    const key = this.cacheKey(provider, model, unit, region);
    const cached = this.rateCache.get(key);
    if (cached !== undefined) return cached;

    const rate = await this.prisma.pricingRate.findFirst({
      where: { provider, model, unit, region, validFrom: { lte: new Date() } },
      orderBy: { validFrom: 'desc' },
    });
    const resolved = rate
      ? { unitPriceUsd: Number(rate.unitPriceUsd), perUnits: rate.perUnits }
      : null;
    this.rateCache.set(key, resolved);
    return resolved;
  }

  /**
   * Registra un consumo. Best-effort: non lancia mai. Ritorna il costo USD
   * calcolato (0 se listino mancante o quantità nulla).
   */
  async record(event: UsageEvent): Promise<number> {
    try {
      if (!Number.isFinite(event.quantity) || event.quantity <= 0) return 0;
      const region = event.region ?? this.defaultRegion(event.provider);
      const rate = await this.resolveRate(event.provider, event.model, event.unit, region);
      if (!rate) {
        this.logger.warn(
          `Listino mancante per ${event.provider}/${event.model}/${event.unit}/${region}: ` +
            `consumo registrato a costo 0 (${event.quantity} ${event.unit}).`,
        );
      }
      const unitPriceUsd = rate?.unitPriceUsd ?? 0;
      const perUnits = rate?.perUnits ?? 1;
      const costUsd = computeCostUsd(event.quantity, unitPriceUsd, perUnits);

      await this.prisma.usageRecord.create({
        data: {
          tenantId: event.tenantId,
          courseId: event.courseId ?? null,
          jobId: event.jobId ?? null,
          provider: event.provider,
          model: event.model,
          unit: event.unit,
          quantity: Math.round(event.quantity),
          unitPriceUsd: new Prisma.Decimal(unitPriceUsd),
          perUnits,
          costUsd: new Prisma.Decimal(costUsd),
          source: event.source,
        },
      });
      return costUsd;
    } catch (err) {
      // Il metering non deve mai far fallire la generazione.
      this.logger.warn(
        `Metering non riuscito (${event.provider}/${event.source}): ${
          err instanceof Error ? err.message : 'errore'
        }`,
      );
      return 0;
    }
  }
}
