import { describe, it, expect, vi } from 'vitest';
import { BrandsService, type BrandDefinition } from './brands.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { QuotaService } from '../plans/quota.service.js';

const validDef: BrandDefinition = {
  name: 'Acme',
  assets: { logoPrimaryUrl: 'https://cdn/logo.svg' },
  colors: {
    primary: '#0055FF',
    onPrimary: '#FFFFFF',
    surface: '#FFFFFF',
    onSurface: '#111111',
    success: '#2E7D32',
    warning: '#ED6C02',
    error: '#D32F2F',
  },
  typography: { fontFamilyHeading: 'Inter', fontFamilyBody: 'Inter' },
};

function makeService(opts?: {
  assertWithinLimit?: () => Promise<void>;
  existing?: { id: string; definition: unknown } | null;
}) {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'brand_1',
    definition: data.definition,
  }));
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'brand_1',
    definition: data.definition,
  }));
  const prisma = {
    brand: {
      create,
      update,
      findFirst: async () =>
        opts?.existing === undefined ? { id: 'brand_1', definition: validDef } : opts.existing,
      findMany: async () => [{ id: 'brand_1', definition: validDef }],
    },
  } as unknown as PrismaService;
  const quota = {
    assertWithinLimit: opts?.assertWithinLimit ?? (async () => undefined),
  } as unknown as QuotaService;
  return { service: new BrandsService(prisma, quota), create, update };
}

describe('BrandsService', () => {
  it('crea un brand valido rispettando la quota', async () => {
    const { service, create } = makeService();
    const view = await service.create('t1', validDef);
    expect(create).toHaveBeenCalledOnce();
    expect(view.name).toBe('Acme');
    expect(view.id).toBe('brand_1');
    expect(view.tenantId).toBe('t1');
  });

  it('non salva id/tenantId dentro la definition JSONB', async () => {
    const { service, create } = makeService();
    await service.create('t1', validDef);
    const saved = create.mock.calls[0]?.[0]?.data?.definition as Record<string, unknown>;
    expect(saved).not.toHaveProperty('id');
    expect(saved).not.toHaveProperty('tenantId');
  });

  it('blocca la creazione oltre la quota brand', async () => {
    const { service } = makeService({
      assertWithinLimit: async () => {
        throw new Error('quota brand superata');
      },
    });
    await expect(service.create('t1', validDef)).rejects.toThrow(/quota/);
  });

  it('rifiuta una definizione con colore non valido', async () => {
    const { service } = makeService();
    const bad = { ...validDef, colors: { ...validDef.colors, primary: 'blu' } };
    await expect(service.create('t1', bad as BrandDefinition)).rejects.toThrow();
  });

  it('compila il tema CSS del brand', async () => {
    const { service } = makeService();
    const theme = await service.compileTheme('t1', 'brand_1');
    expect(theme.css).toContain('--brand-primary: #0055FF;');
  });
});
