import { describe, it, expect, vi } from 'vitest';
import { CoursesService } from './courses.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { QuotaService } from '../plans/quota.service.js';

function makeService(opts?: {
  courseExists?: boolean;
  brandCount?: number;
  assertWithinLimit?: () => Promise<void>;
}) {
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'c1',
    title: (data.title as string) ?? 'Corso',
    description: '',
    language: (data.language as string) ?? 'it',
    status: 'DRAFT',
    brief: data.brief ?? null,
    interactionStyle: (data.interactionStyle as string) ?? null,
  }));
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'c1',
    title: data.title,
    description: data.description ?? '',
    language: data.language,
    status: 'DRAFT',
    brief: null,
  }));
  const prisma = {
    course: {
      create,
      findFirst: async () => (opts?.courseExists === false ? null : { id: 'c1', title: 'Corso', description: '', language: 'it', status: 'DRAFT', brief: null }),
      update,
    },
    brand: { count: async () => opts?.brandCount ?? 0 },
  } as unknown as PrismaService;

  const quota = {
    assertWithinLimit: opts?.assertWithinLimit ?? (async () => undefined),
  } as unknown as QuotaService;

  const storage = {
    getSignedUrl: async () => 'https://signed.example/cover',
  } as unknown as import('@scorm/domain').ObjectStorage;

  return { service: new CoursesService(prisma, quota, storage), create, update };
}

describe('CoursesService', () => {
  it('crea un corso rispettando la quota', async () => {
    const { service, create } = makeService();
    const view = await service.create({ tenantId: 't', title: 'Corso', language: 'it' });
    expect(create).toHaveBeenCalledOnce();
    expect(view.status).toBe('DRAFT');
  });

  it('blocca la creazione se la quota è superata', async () => {
    const { service } = makeService({
      assertWithinLimit: async () => {
        throw new Error('quota superata');
      },
    });
    await expect(
      service.create({ tenantId: 't', title: 'X', language: 'it' }),
    ).rejects.toThrow(/quota/);
  });

  it('salva una bozza di brief parziale', async () => {
    const { service, update } = makeService();
    const view = await service.saveBriefDraft('t', 'c1', { title: 'Solo titolo' });
    expect(update).toHaveBeenCalledOnce();
    expect(view.brief?.title).toBe('Solo titolo');
  });

  it('rifiuta un brief con brand inesistenti', async () => {
    const { service } = makeService({ brandCount: 0 });
    await expect(
      service.saveBriefDraft('t', 'c1', { brandIds: ['b1', 'b2'] }),
    ).rejects.toThrow(/brand/i);
  });

  it('accetta un brief con brand esistenti', async () => {
    const { service } = makeService({ brandCount: 2 });
    const view = await service.saveBriefDraft('t', 'c1', { brandIds: ['b1', 'b2'] });
    expect(view.id).toBe('c1');
  });

  it('salva un brief completo allineando titolo e lingua del corso', async () => {
    const { service, update } = makeService();
    await service.saveBrief('t', 'c1', {
      title: 'Sicurezza',
      learningObjectives: ['Obiettivo'],
      targetAudience: 'Tutti',
      level: 'beginner',
      estimatedDurationMinutes: 60,
      language: 'it',
      requestedAssessments: [],
      constraints: [],
      brandIds: [],
    });
    const data = update.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data.title).toBe('Sicurezza');
    expect(data.language).toBe('it');
  });

  it('aggiorna lo stile delle interazioni del corso', async () => {
    const { service, update } = makeService();
    const view = await service.updateSettings('t', 'c1', { interactionStyle: 'lively' });
    const data = update.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data.interactionStyle).toBe('lively');
    expect(view.interactionStyle).toBe('lively');
  });

  it('default a "sober" quando interactionStyle non è presente nel record', async () => {
    const { service } = makeService();
    const view = await service.create({ tenantId: 't', title: 'Corso', language: 'it' });
    expect(view.interactionStyle).toBe('sober');
  });
});
