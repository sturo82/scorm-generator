import { describe, it, expect } from 'vitest';
import { QuotaService, startOfMonthUtc } from './quota.service.js';
import { QuotaExceededException } from './quota.exception.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/** Costruisce un QuotaService con un PrismaService fittizio. */
function makeService(opts: {
  limits?: Record<string, number | null>;
  featureFlags?: Record<string, boolean>;
  counts?: Partial<Record<'course' | 'brand' | 'user' | 'scormPackage', number>>;
  knowledgeBytes?: number;
}): QuotaService {
  const prisma = {
    tenant: {
      findUnique: async () => ({
        plan: {
          limits: opts.limits ?? {},
          featureFlags: opts.featureFlags ?? {},
        },
      }),
    },
    course: { count: async () => opts.counts?.course ?? 0 },
    brand: { count: async () => opts.counts?.brand ?? 0 },
    user: { count: async () => opts.counts?.user ?? 0 },
    scormPackage: { count: async () => opts.counts?.scormPackage ?? 0 },
    knowledgeDoc: {
      aggregate: async () => ({ _sum: { sizeBytes: opts.knowledgeBytes ?? 0 } }),
    },
  } as unknown as PrismaService;

  return new QuotaService(prisma);
}

describe('QuotaService', () => {
  it('non blocca quando il limite è illimitato (null)', async () => {
    const svc = makeService({ limits: { maxCourses: null }, counts: { course: 9999 } });
    await expect(svc.assertWithinLimit('t', 'courses')).resolves.toBeUndefined();
  });

  it('consente fino al limite', async () => {
    const svc = makeService({ limits: { maxCourses: 10 }, counts: { course: 9 } });
    await expect(svc.assertWithinLimit('t', 'courses')).resolves.toBeUndefined();
  });

  it('blocca al superamento con QuotaExceededException', async () => {
    const svc = makeService({ limits: { maxCourses: 10 }, counts: { course: 10 } });
    await expect(svc.assertWithinLimit('t', 'courses')).rejects.toBeInstanceOf(
      QuotaExceededException,
    );
  });

  it('considera l amount richiesto', async () => {
    const svc = makeService({ limits: { maxBrands: 3 }, counts: { brand: 2 } });
    await expect(svc.assertWithinLimit('t', 'brands', 2)).rejects.toBeInstanceOf(
      QuotaExceededException,
    );
  });

  it('converte i byte della knowledge in megabyte', async () => {
    const svc = makeService({ knowledgeBytes: 2 * 1024 * 1024 });
    expect(await svc.getUsage('t', 'knowledgeMb')).toBe(2);
  });

  it('calcola lo stato con remaining', async () => {
    const svc = makeService({ limits: { maxUsers: 10 }, counts: { user: 4 } });
    const status = await svc.getStatus('t', 'users');
    expect(status).toEqual({ resource: 'users', limit: 10, current: 4, remaining: 6 });
  });

  it('espone remaining null per risorse illimitate', async () => {
    const svc = makeService({ limits: { maxUsers: null }, counts: { user: 4 } });
    const status = await svc.getStatus('t', 'users');
    expect(status.remaining).toBeNull();
  });

  it('legge i feature flag', async () => {
    const svc = makeService({ featureFlags: { sso: true } });
    expect(await svc.isFeatureEnabled('t', 'sso')).toBe(true);
    expect(await svc.isFeatureEnabled('t', 'dataDeletion')).toBe(false);
  });
});

describe('startOfMonthUtc', () => {
  it('restituisce il primo giorno del mese in UTC', () => {
    const d = startOfMonthUtc(new Date('2026-03-15T12:34:56Z'));
    expect(d.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });
});
