import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import JSZip from 'jszip';
import { PrismaClient } from '@prisma/client';
import { testing } from '@scorm/adapters';
import {
  DEFAULT_PLAN_LIMITS,
  DEFAULT_FEATURE_FLAGS,
  type Brand as BrandType,
} from '@scorm/contracts';
import type { RequestContext } from '@scorm/domain';
import { QuotaService } from '../../src/plans/quota.service.js';
import { CoursesService } from '../../src/courses/courses.service.js';
import { ModulesService } from '../../src/courses/modules.service.js';
import { GenerationService } from '../../src/generation/generation.service.js';
import { EditorialService } from '../../src/editorial/editorial.service.js';
import { ExportService } from '../../src/export/export.service.js';
import { RetrievalService } from '../../src/knowledge/retrieval.service.js';
import { AuditService } from '../../src/observability/audit.service.js';
import type { AuthContext } from '../../src/auth/auth-context.js';

/**
 * Test E2E del flusso completo (Requisito 2.1 / 4.1 / 4.2 / 7.3 / 8.1 / 9.1):
 * brief → outline → moduli/lezioni → generazione contenuti → approvazione →
 * export per due brand diversi → due pacchetti SCORM validi e distinti.
 *
 * Richiede un Postgres reale con migrazioni applicate (DATABASE_URL). Usa il
 * MockLLMProvider (nessuna dipendenza da Bedrock) e LocalObjectStorage.
 */

const prisma = new PrismaClient();
// Il MockLLMProvider campiona bene outline/assessment, ma la union complessa dei
// Block è difficile da generare automaticamente: per la fase contenuti forniamo
// un responder deterministico che restituisce un Block valido quando la richiesta
// riguarda i block della lezione.
const llm = new testing.MockLLMProvider({
  responder: (input) => {
    const schema = input.schema as { properties?: Record<string, unknown> } | undefined;
    if (schema?.properties && 'blocks' in schema.properties) {
      return JSON.stringify({
        blocks: [
          {
            id: 'blk-e2e',
            type: 'rich_text',
            editorial: { status: 'draft', citations: [] },
            payload: { content: { format: 'html', html: '<p>Contenuto E2E</p>' }, media: [] },
          },
        ],
      });
    }
    return undefined; // altrove: comportamento di default (campionamento schema)
  },
});
const embeddings = new testing.MockEmbeddingsProvider(64);
const vectors = new testing.InMemoryVectorStore();
const storage = new testing.LocalObjectStorage();

// Service composti a mano con le dipendenze reali/mocked.
const quota = new QuotaService(prisma as never);
const audit = new AuditService(prisma as never);
const courses = new CoursesService(prisma as never, quota);
const modules = new ModulesService(prisma as never);
const retrieval = new RetrievalService(embeddings, vectors);
const generation = new GenerationService(prisma as never, llm, retrieval);
const editorial = new EditorialService(prisma as never);
const exportService = new ExportService(prisma as never, quota, audit, storage);

const tenantId = `e2e_${Date.now()}`;
const ctx: AuthContext = { tenant: { tenantId }, userId: 'u-e2e', role: 'OWNER', correlationId: 'e2e-corr' };
const reqCtx: RequestContext = { tenant: { tenantId }, correlationId: 'e2e-corr' };

async function unzip(buf: Buffer): Promise<JSZip> {
  return JSZip.loadAsync(buf);
}

function brandDef(name: string, primary: string): Omit<BrandType, 'id' | 'tenantId'> {
  return {
    name,
    assets: { logoPrimaryUrl: `https://cdn/${name}.svg` },
    colors: {
      primary,
      onPrimary: '#FFFFFF',
      surface: '#FFFFFF',
      onSurface: '#111111',
      success: '#2E7D32',
      warning: '#ED6C02',
      error: '#D32F2F',
    },
    typography: { fontFamilyHeading: 'Inter', fontFamilyBody: 'Inter' },
  };
}

describe('E2E: flusso completo brief → export multi-brand', () => {
  let brandA = '';
  let brandB = '';

  beforeAll(async () => {
    await prisma.$connect();
    // Imposta il tenant GUC per attraversare le policy RLS in scrittura.
    await prisma.$executeRawUnsafe(`SELECT set_config('app.current_tenant', '${tenantId}', false)`);
    const plan = await prisma.plan.create({
      data: { tier: 'ENTERPRISE', limits: DEFAULT_PLAN_LIMITS.ENTERPRISE, featureFlags: DEFAULT_FEATURE_FLAGS.ENTERPRISE },
    });
    await prisma.tenant.create({ data: { id: tenantId, name: 'E2E Tenant', planId: plan.id } });
    const a = await prisma.brand.create({ data: { tenantId, name: 'Acme', definition: brandDef('Acme', '#0055FF') } });
    const b = await prisma.brand.create({ data: { tenantId, name: 'Globex', definition: brandDef('Globex', '#FF3300') } });
    brandA = a.id;
    brandB = b.id;
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`SELECT set_config('app.current_tenant', '${tenantId}', false)`);
    await prisma.auditEvent.deleteMany({ where: { tenantId } });
    await prisma.course.deleteMany({ where: { tenantId } });
    await prisma.brand.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (t) {
      await prisma.tenant.delete({ where: { id: tenantId } });
      await prisma.plan.delete({ where: { id: t.planId } });
    }
    await prisma.$disconnect();
  });

  it('percorre brief → outline → contenuti → approvazione → export 2 brand', async () => {
    // 1. Crea corso e salva un brief completo.
    const course = await courses.create({ tenantId, title: 'Sicurezza', language: 'it' });
    await courses.saveBrief(tenantId, course.id, {
      title: 'Sicurezza sul lavoro',
      learningObjectives: ['Riconoscere i rischi'],
      targetAudience: 'Neoassunti',
      level: 'beginner',
      estimatedDurationMinutes: 60,
      language: 'it',
      requestedAssessments: ['final'],
      constraints: [],
      brandIds: [brandA, brandB],
    });

    // 2. Genera l'outline (MockLLM, output conforme allo schema).
    const outline = await generation.generateOutline(reqCtx, course.id);
    expect(outline.modules.length).toBeGreaterThan(0);

    // 3. Crea un modulo + lezione e genera i contenuti.
    const module = await modules.addModule(tenantId, course.id, { title: 'Modulo 1' });
    const lesson = await modules.addLesson(tenantId, course.id, module.id, { title: 'Lezione 1' });
    const blocks = await generation.generateLessonContent(reqCtx, course.id, lesson.id);
    expect(blocks.length).toBeGreaterThan(0);

    // 4. Approva corso, modulo e lezione (gate HITL per l'export).
    await editorial.setStatus(tenantId, course.id, 'course', course.id, 'APPROVED');
    await editorial.setStatus(tenantId, course.id, 'module', module.id, 'APPROVED');
    await editorial.setStatus(tenantId, course.id, 'lesson', lesson.id, 'APPROVED');

    // 5. Export per i due brand.
    const expA = await exportService.exportCourse({ tenantId, courseId: course.id, brandId: brandA, profile: 'SCORM_2004_4TH', authContext: ctx });
    const expB = await exportService.exportCourse({ tenantId, courseId: course.id, brandId: brandB, profile: 'SCORM_2004_4TH', authContext: ctx });

    expect(expA.packageId).not.toBe(expB.packageId);

    // 6. Scarica i due pacchetti dallo storage e verifica che siano distinti.
    const keyA = `packages/${tenantId}/${course.id}`;
    // Recupera gli oggetti salvati tramite le chiavi note (storage locale).
    // In alternativa si potrebbe seguire il downloadUrl firmato.
    const built = await Promise.all([
      exportService.exportCourse({ tenantId, courseId: course.id, brandId: brandA, profile: 'SCORM_2004_4TH', authContext: ctx }),
      exportService.exportCourse({ tenantId, courseId: course.id, brandId: brandB, profile: 'SCORM_2004_4TH', authContext: ctx }),
    ]);
    expect(built[0].version).toBeGreaterThan(0);

    // 7. Verifica diretta sui pacchetti ricostruiti dal builder (contenuto zip).
    const zipA = await unzip(await storage.getObject(await resolveLatestKey(keyA, brandA)));
    const zipB = await unzip(await storage.getObject(await resolveLatestKey(keyA, brandB)));
    const cssA = await zipA.file('assets/theme/theme.css')!.async('string');
    const cssB = await zipB.file('assets/theme/theme.css')!.async('string');
    expect(cssA).toContain('#0055FF');
    expect(cssB).toContain('#FF3300');
    expect(cssA).not.toEqual(cssB);
    // Entrambi contengono il manifest SCORM e il runtime.
    expect(zipA.file('imsmanifest.xml')).toBeTruthy();
    expect(zipB.file('runtime/player.js')).toBeTruthy();
  });

  /** Trova l'ultima chiave di pacchetto salvata per un dato brand. */
  async function resolveLatestKey(prefix: string, brandId: string): Promise<string> {
    const builds = await prisma.courseBrandBuild.findMany({ where: { brandId } });
    const build = builds[0];
    const pkg = await prisma.scormPackage.findFirst({
      where: { buildId: build!.id, storageKey: { not: null } },
      orderBy: { version: 'desc' },
    });
    void prefix;
    return pkg!.storageKey!;
  }
});
