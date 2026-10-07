import { describe, it, expect, vi } from 'vitest';
import { KnowledgeService } from './knowledge.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { QuotaService } from '../plans/quota.service.js';
import type { ConfigService } from '@nestjs/config';
import type { ObjectStorage, VectorStore } from '@scorm/domain';

function makeService(overrides?: {
  maxFileBytes?: number;
  courseExists?: boolean;
  assertWithinLimit?: () => Promise<void>;
}) {
  const putObject = vi.fn(async () => undefined);
  const deleteByDocument = vi.fn(async () => undefined);
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: data.id,
    filename: data.filename,
    mimeType: data.mimeType,
    sizeBytes: data.sizeBytes,
    scope: data.scope,
    courseId: data.courseId ?? null,
    status: data.status,
  }));

  const prisma = {
    course: { findFirst: async () => (overrides?.courseExists ? { id: 'c1' } : null) },
    knowledgeDoc: { create },
  } as unknown as PrismaService;

  const quota = {
    assertWithinLimit: overrides?.assertWithinLimit ?? (async () => undefined),
  } as unknown as QuotaService;

  const config = {
    get: () => ({ maxFileBytes: overrides?.maxFileBytes ?? 50 * 1024 * 1024 }),
  } as unknown as ConfigService;

  const storage = { putObject } as unknown as ObjectStorage;
  const vectors = { deleteByDocument } as unknown as VectorStore;
  const enqueue = vi.fn(async () => 'job_1');
  const jobs = { enqueue } as unknown as import('@scorm/domain').JobQueue;

  const service = new KnowledgeService(prisma, quota, config, storage, vectors, jobs);
  return { service, putObject, create, enqueue };
}

const txt = Buffer.from('contenuto di prova');

describe('KnowledgeService.upload', () => {
  it('rifiuta un MIME non supportato', async () => {
    const { service } = makeService();
    await expect(
      service.upload({
        tenantId: 't1',
        scope: 'GLOBAL',
        filename: 'a.exe',
        mimeType: 'application/x-msdownload',
        content: txt,
      }),
    ).rejects.toThrow(/non supportato/i);
  });

  it('rifiuta un file vuoto', async () => {
    const { service } = makeService();
    await expect(
      service.upload({
        tenantId: 't1',
        scope: 'GLOBAL',
        filename: 'a.txt',
        mimeType: 'text/plain',
        content: Buffer.alloc(0),
      }),
    ).rejects.toThrow(/vuoto/i);
  });

  it('rifiuta un file oltre la dimensione massima', async () => {
    const { service } = makeService({ maxFileBytes: 5 });
    await expect(
      service.upload({
        tenantId: 't1',
        scope: 'GLOBAL',
        filename: 'a.txt',
        mimeType: 'text/plain',
        content: txt,
      }),
    ).rejects.toThrow(/troppo grande/i);
  });

  it('rifiuta scope COURSE senza courseId', async () => {
    const { service } = makeService();
    await expect(
      service.upload({
        tenantId: 't1',
        scope: 'COURSE',
        filename: 'a.txt',
        mimeType: 'text/plain',
        content: txt,
      }),
    ).rejects.toThrow(/courseId obbligatorio/i);
  });

  it('rifiuta scope COURSE se il corso non appartiene al tenant', async () => {
    const { service } = makeService({ courseExists: false });
    await expect(
      service.upload({
        tenantId: 't1',
        scope: 'COURSE',
        courseId: 'c1',
        filename: 'a.txt',
        mimeType: 'text/plain',
        content: txt,
      }),
    ).rejects.toThrow(/non trovato/i);
  });

  it('salva su storage e crea il record in stato PENDING', async () => {
    const { service, putObject, create } = makeService();
    const view = await service.upload({
      tenantId: 't1',
      scope: 'GLOBAL',
      filename: 'nota tecnica.txt',
      mimeType: 'text/plain',
      content: txt,
    });
    expect(putObject).toHaveBeenCalledOnce();
    // La chiave di storage sanifica il nome file.
    const key = putObject.mock.calls[0]?.[0] as string;
    expect(key).toMatch(/^knowledge\/t1\//);
    expect(key).not.toContain(' ');
    expect(create).toHaveBeenCalledOnce();
    expect(view.status).toBe('PENDING');
    expect(view.scope).toBe('GLOBAL');
  });

  it('accoda il job di ingestion dopo l upload', async () => {
    const { service, enqueue } = makeService();
    await service.upload({
      tenantId: 't1',
      scope: 'GLOBAL',
      filename: 'a.txt',
      mimeType: 'text/plain',
      content: txt,
    });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue.mock.calls[0]?.[0]).toBe('knowledge.ingest');
  });

  it('propaga il superamento di quota', async () => {
    const { service } = makeService({
      assertWithinLimit: async () => {
        throw new Error('quota superata');
      },
    });
    await expect(
      service.upload({
        tenantId: 't1',
        scope: 'GLOBAL',
        filename: 'a.txt',
        mimeType: 'text/plain',
        content: txt,
      }),
    ).rejects.toThrow(/quota superata/);
  });
});
