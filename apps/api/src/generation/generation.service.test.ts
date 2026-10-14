import { testing } from '@scorm/adapters';
import type { JobQueue, RequestContext } from '@scorm/domain';
import { GenerationService, coerceBlocksArray, describeShape } from './generation.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RetrievalService } from '../knowledge/retrieval.service.js';
import type { ModulesService } from '../courses/modules.service.js';
import type { MediaService } from './media.service.js';
import type { UsageMeterService } from '../metering/usage-meter.service.js';

const ctx: RequestContext = { tenant: { tenantId: 't1' }, correlationId: 'corr-1' };

const validBrief = {
  title: 'Sicurezza',
  learningObjectives: ['Obiettivo A'],
  targetAudience: 'Tutti',
  level: 'beginner',
  estimatedDurationMinutes: 60,
  language: 'it',
  requestedAssessments: ['final'],
  constraints: [],
  brandIds: [],
};

function makeService(opts?: { course?: unknown }) {
  const jobCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'job1', ...data }));
  const jobUpdate = vi.fn(async () => ({}));
  const jobUpdateMany = vi.fn(async () => ({ count: 2 }));
  const courseUpdate = vi.fn(async () => ({}));
  const enqueue = vi.fn(async () => 'q1');

  const prisma = {
    course: {
      findFirst: async () =>
        opts?.course === undefined
          ? { id: 'c1', tenantId: 't1', title: 'Sicurezza', language: 'it', brief: validBrief }
          : opts.course,
      update: courseUpdate,
    },
    brand: { findFirst: async () => null },
    generationJob: {
      create: jobCreate,
      update: jobUpdate,
      updateMany: jobUpdateMany,
      findFirst: async () => ({ id: 'job1', type: 'course.generate_outline', status: 'COMPLETED', createdAt: new Date(), finishedAt: new Date(), error: null }),
      findMany: async () => [],
    },
  } as unknown as PrismaService;

  const retrieval = {
    retrieve: async () => ({ chunks: [], citations: [] }),
  } as unknown as RetrievalService;

  const jobs = { id: 'test', enqueue, register: vi.fn() } as unknown as JobQueue;
  const materializeOutline = vi.fn(async () => []);
  const modules = { materializeOutline } as unknown as ModulesService;

  const llm = new testing.MockLLMProvider();
  // Media e metering non sono il focus di questi test: mock minimali no-op.
  const media = {
    generateLessonImages: vi.fn(async () => ({ generated: 0, skipped: 0, failed: 0, warnings: [] })),
  } as unknown as MediaService;
  const meterRecord = vi.fn(async () => 0);
  const meter = { record: meterRecord } as unknown as UsageMeterService;

  return {
    service: new GenerationService(prisma, llm, jobs, retrieval, modules, media, meter),
    jobCreate,
    jobUpdate,
    jobUpdateMany,
    courseUpdate,
    enqueue,
    materializeOutline,
    meterRecord,
  };
}

describe('GenerationService (async)', () => {
  it('enqueueOutline crea un job QUEUED e lo accoda, ritornando il jobId', async () => {
    const { service, jobCreate, enqueue } = makeService();
    const res = await service.enqueueOutline(ctx, 'c1');
    expect(res.jobId).toBeTruthy();
    expect(jobCreate.mock.calls[0]?.[0]?.data).toMatchObject({
      type: 'course.generate_outline',
      status: 'QUEUED',
      correlationId: 'corr-1',
    });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue.mock.calls[0]?.[0]).toBe('course.generate_outline');
  });

  it('enqueueOutline lancia NotFound se il corso non esiste', async () => {
    const { service } = makeService({ course: null });
    await expect(service.enqueueOutline(ctx, 'missing')).rejects.toThrow(/non trovato/i);
  });

  it('handleJob(outline) esegue il modello, salva l’outline, materializza e marca COMPLETED', async () => {
    const { service, jobUpdate, courseUpdate, materializeOutline, meterRecord } = makeService();
    await service.handleJob({ type: 'course.generate_outline', jobId: 'job1', courseId: 'c1' }, ctx);
    // Salva l'outline sul corso.
    expect(courseUpdate).toHaveBeenCalled();
    // Materializzazione automatica.
    expect(materializeOutline).toHaveBeenCalledWith('t1', 'c1');
    // Metering del consumo (input + output token).
    expect(meterRecord).toHaveBeenCalled();
    // RUNNING poi COMPLETED.
    const statuses = jobUpdate.mock.calls.map((c) => c[0]?.data?.status);
    expect(statuses).toContain('RUNNING');
    expect(statuses).toContain('COMPLETED');
  });

  it('handleJob marca FAILED e rilancia se la generazione produce output non valido', async () => {
    const { service, jobUpdate } = makeService();
    const badLlm = new testing.MockLLMProvider({ responder: () => '{ not json' });
    // @ts-expect-error accesso controllato per il test
    service.llm = badLlm;
    await expect(
      service.handleJob({ type: 'course.generate_outline', jobId: 'job1', courseId: 'c1' }, ctx),
    ).rejects.toBeTruthy();
    const failed = jobUpdate.mock.calls.find((c) => c[0]?.data?.status === 'FAILED');
    expect(failed).toBeTruthy();
  });

  it('getJob ritorna lo stato del job (isolato per tenant/corso)', async () => {
    const { service } = makeService();
    const view = await service.getJob('t1', 'c1', 'job1');
    expect(view.id).toBe('job1');
    expect(view.status).toBe('COMPLETED');
  });

  it('recoverStaleJobs marca FAILED i job QUEUED/RUNNING vecchi oltre la soglia', async () => {
    const { service, jobUpdateMany } = makeService();
    const count = await service.recoverStaleJobs(60_000);
    expect(count).toBe(2);
    const where = jobUpdateMany.mock.calls[0]?.[0]?.where;
    expect(where?.status).toEqual({ in: ['QUEUED', 'RUNNING'] });
    expect(where?.createdAt?.lt).toBeInstanceOf(Date);
    const data = jobUpdateMany.mock.calls[0]?.[0]?.data;
    expect(data?.status).toBe('FAILED');
  });
});

describe('coerceBlocksArray', () => {
  const arr = [{ type: 'rich_text' }];

  it('estrae l\'array dalla forma attesa { blocks: [...] }', () => {
    expect(coerceBlocksArray({ blocks: arr })).toEqual(arr);
  });

  it('ri-parsa blocks quando è una stringa JSON (il caso che faceva fallire la lezione)', () => {
    expect(coerceBlocksArray({ blocks: JSON.stringify(arr) })).toEqual(arr);
  });

  it('accetta un array restituito al top-level', () => {
    expect(coerceBlocksArray(arr)).toEqual(arr);
  });

  it('ri-parsa una stringa JSON di array al top-level', () => {
    expect(coerceBlocksArray(JSON.stringify(arr))).toEqual(arr);
  });

  it('ritorna [] quando non c\'è un array interpretabile', () => {
    expect(coerceBlocksArray({ blocks: 42 })).toEqual([]);
    expect(coerceBlocksArray('non-json')).toEqual([]);
    expect(coerceBlocksArray(null)).toEqual([]);
  });
});

describe('describeShape', () => {
  it('descrive un oggetto con blocks array', () => {
    expect(describeShape({ blocks: [{ type: 'rich_text' }] })).toBe(
      'object{keys=[blocks],blocks=array(len=1)}',
    );
  });

  it('segnala blocks come stringa', () => {
    expect(describeShape({ blocks: '[]' })).toBe('object{keys=[blocks],blocks=string(len=2)}');
  });

  it('segnala blocks assente e array/stringa/null top-level', () => {
    expect(describeShape({ foo: 1 })).toBe('object{keys=[foo],blocks=absent}');
    expect(describeShape([1, 2])).toBe('array(len=2)');
    expect(describeShape('abc')).toBe('string(len=3)');
    expect(describeShape(null)).toBe('null');
  });
});
