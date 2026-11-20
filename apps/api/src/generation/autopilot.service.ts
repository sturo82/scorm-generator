import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  Brief,
  CourseEstimateOptions,
  resolveLessonLayout,
  type AutopilotPhase,
  type AutopilotStatus,
  type AutopilotView,
  type StartAutopilot,
} from '@scorm/contracts';
import type { RequestContext } from '@scorm/domain';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantPrismaService } from '../tenancy/tenant-prisma.service.js';
import { currentPayer, runWithPayer, type Payer } from '../billing/payer-context.js';
import { GenerationService } from './generation.service.js';
import { BillingService } from '../billing/billing.service.js';
import { InsufficientCreditsException } from '../ecosystem/wallet.service.js';
import { MediaService } from './media.service.js';
import { collectCartoonScenes, isPlaceholderVideo } from './cartoon-scenes.js';

/** Stato persistito sul corso (`Course.autopilot`): sopravvive ai riavvii. */
interface AutopilotDoc {
  status: AutopilotStatus;
  phase: AutopilotPhase;
  reviewStructure: boolean;
  /** True quando l'utente ha approvato la struttura (riparte dopo la revisione). */
  structureApproved?: boolean;
  options: CourseEstimateOptions;
  /** Contesto di chi ha avviato la generazione: il lavoro in background non ha una richiesta. */
  ctx: { tenantId: string; userId?: string };
  payer?: Payer;
  issues: string[];
  error?: string;
  errorCode?: 'insufficient_credits';
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  owner?: string;
  leaseUntil?: number;
}

const LEASE_MS = 120_000;
const HEARTBEAT_MS = 30_000;

/**
 * Generazione automatica del corso. Dopo il preventivo confermato esegue, in un solo lavoro sul
 * server: struttura → (revisione facoltativa) → contenuti con immagini → test → copertina →
 * componenti scelte nel preventivo (copertine dei moduli, voce narrante, video delle pillole).
 * Ogni fase salta ciò che è già pronto, così dopo un riavvio si riprende da dove era. Un lease
 * evita che due processi lavorino sullo stesso corso. La spesa è nel budget già confermato.
 */
@Injectable()
export class AutopilotService implements OnModuleInit {
  private readonly logger = new Logger(AutopilotService.name);
  private readonly instanceId = randomUUID();
  private readonly active = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly generation: GenerationService,
    private readonly media: MediaService,
    private readonly billing: BillingService,
  ) {}

  /**
   * Prima di partire: il saldo del wallet che paga deve coprire il massimo di quanto resta da
   * generare, altrimenti la generazione si fermerebbe a metà. 402 con richiesti e disponibili.
   */
  private async assertCredits(tenantId: string, courseId: string, options?: Partial<CourseEstimateOptions>): Promise<void> {
    const est = await this.billing.estimateExistingCourse(tenantId, courseId, options);
    if (est.billed && est.available !== undefined && est.available < est.total) {
      throw new InsufficientCreditsException('course', est.total, est.available);
    }
  }

  /** Riprende i lavori rimasti in corso dopo un riavvio. Non blocca l'avvio. */
  onModuleInit(): void {
    setTimeout(() => void this.resumeAll().catch(() => undefined), 15_000).unref?.();
  }

  private async resumeAll(): Promise<void> {
    const rows = await this.prisma.course.findMany({
      where: { autopilot: { path: ['status'], equals: 'running' } },
      select: { id: true, tenantId: true, autopilot: true },
    });
    for (const r of rows) {
      const doc = r.autopilot as unknown as AutopilotDoc;
      if ((doc.leaseUntil ?? 0) <= Date.now()) this.launch(r.tenantId, r.id);
    }
  }

  async start(ctx: RequestContext, courseId: string, input: StartAutopilot): Promise<AutopilotView> {
    const tenantId = ctx.tenant.tenantId;
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, tenantId },
      select: { brief: true, autopilot: true, estimateOptions: true },
    });
    if (!course) throw new NotFoundException('Corso non trovato');
    if (!course.brief || !Brief.safeParse(course.brief).success) {
      throw new BadRequestException('Il brief del corso non è completo: completalo prima di generare.');
    }
    const existing = course.autopilot as AutopilotDoc | null;
    if (existing && (existing.status === 'running' || existing.status === 'paused')) {
      throw new ConflictException('La generazione del corso è già in corso.');
    }
    const stored = CourseEstimateOptions.safeParse(course.estimateOptions ?? {});
    await this.assertCredits(tenantId, courseId, { ...(stored.success ? stored.data : {}), ...(input.options ?? {}) });
    const now = new Date().toISOString();
    const doc: AutopilotDoc = {
      status: 'running',
      phase: 'structure',
      reviewStructure: input.reviewStructure,
      options: { ...(stored.success ? stored.data : CourseEstimateOptions.parse({})), ...(input.options ?? {}) },
      ctx: { tenantId, userId: ctx.userId },
      payer: currentPayer(),
      issues: [],
      startedAt: now,
      updatedAt: now,
    };
    await this.save(tenantId, courseId, doc);
    this.launch(tenantId, courseId);
    return this.view(tenantId, courseId, doc);
  }

  /** Dopo la revisione della struttura: riparte con i contenuti. */
  async resume(tenantId: string, courseId: string): Promise<AutopilotView> {
    const doc = await this.load(tenantId, courseId);
    if (!doc || doc.status !== 'paused') throw new ConflictException('Nessuna generazione in attesa di conferma.');
    // La struttura può essere stata modificata (lezioni aggiunte): si ricontrolla il saldo.
    await this.assertCredits(tenantId, courseId, doc.options);
    doc.status = 'running';
    doc.structureApproved = true;
    await this.save(tenantId, courseId, doc);
    this.launch(tenantId, courseId);
    return this.view(tenantId, courseId, doc);
  }

  /** Ferma la generazione: la fase in corso finisce il pezzo che sta facendo, le altre non partono. */
  async cancel(tenantId: string, courseId: string): Promise<AutopilotView> {
    const doc = await this.load(tenantId, courseId);
    if (!doc || (doc.status !== 'running' && doc.status !== 'paused')) throw new ConflictException('Nessuna generazione in corso.');
    doc.status = 'cancelled';
    doc.finishedAt = new Date().toISOString();
    await this.save(tenantId, courseId, doc);
    return this.view(tenantId, courseId, doc);
  }

  /** Nasconde il riepilogo finale (l'utente passa al corso). */
  async dismiss(tenantId: string, courseId: string): Promise<void> {
    const doc = await this.load(tenantId, courseId);
    if (!doc || doc.status === 'running' || doc.status === 'paused') return;
    await this.tenantPrisma.runInTenant(tenantId, (tx) =>
      tx.course.updateMany({ where: { id: courseId, tenantId }, data: { autopilot: Prisma.DbNull } }),
    );
  }

  /** Stato e avanzamento; riprende un lavoro orfano (lease scaduto). Null se mai avviata. */
  async status(tenantId: string, courseId: string): Promise<AutopilotView | null> {
    const doc = await this.load(tenantId, courseId);
    if (!doc) return null;
    if (doc.status === 'running' && !this.active.has(courseId) && (doc.leaseUntil ?? 0) <= Date.now()) {
      this.logger.log(`Ripresa generazione automatica orfana (corso ${courseId})`);
      this.launch(tenantId, courseId);
    }
    return this.view(tenantId, courseId, doc);
  }

  // --- Esecuzione ---------------------------------------------------------------

  private launch(tenantId: string, courseId: string): void {
    if (this.active.has(courseId)) return;
    this.active.add(courseId);
    void this.run(tenantId, courseId)
      .catch((err) => this.logger.error(`Generazione automatica fallita (corso ${courseId}): ${errMsg(err)}`))
      .finally(() => this.active.delete(courseId));
  }

  private async run(tenantId: string, courseId: string): Promise<void> {
    const first = await this.load(tenantId, courseId);
    if (!first || first.status !== 'running') return;
    // Il lavoro paga con il wallet di chi l'ha avviato; la spesa è nel budget già confermato.
    await runWithPayer(first.payer, () => this.runPhases(tenantId, courseId));
  }

  private async runPhases(tenantId: string, courseId: string): Promise<void> {
    const doc = (await this.load(tenantId, courseId))!;
    doc.owner = this.instanceId;
    doc.leaseUntil = Date.now() + LEASE_MS;
    await this.save(tenantId, courseId, doc);
    const heartbeat = setInterval(() => void this.touch(tenantId, courseId).catch(() => undefined), HEARTBEAT_MS);
    const ctx: RequestContext = {
      tenant: { tenantId },
      correlationId: `autopilot-${courseId}-${Date.now()}`,
      ...(doc.ctx.userId ? { userId: doc.ctx.userId } : {}),
    };
    try {
      // 1. Struttura.
      if (!(await this.stopped(tenantId, courseId))) {
        await this.setPhase(tenantId, courseId, 'structure');
        const course = await this.prisma.course.findUnique({ where: { id: courseId }, select: { outline: true } });
        if (!course?.outline) await this.attempt(tenantId, courseId, 'struttura', () => this.generation.enqueueOutline(ctx, courseId, true));
      }
      // 2. Revisione facoltativa della struttura: si attende l'utente.
      const afterStructure = await this.load(tenantId, courseId);
      if (afterStructure?.status === 'running' && afterStructure.reviewStructure && !afterStructure.structureApproved) {
        afterStructure.status = 'paused';
        afterStructure.phase = 'review';
        afterStructure.owner = undefined;
        afterStructure.leaseUntil = undefined;
        await this.save(tenantId, courseId, afterStructure);
        return;
      }
      // 3. Contenuti delle lezioni con le immagini (i test previsti si generano alla fine del lotto).
      if (!(await this.stopped(tenantId, courseId))) {
        await this.setPhase(tenantId, courseId, 'content');
        for (let i = 0; i < 2; i++) {
          if ((await this.generation.remainingWork(tenantId, courseId)).pendingLessons === 0) break;
          await this.attempt(tenantId, courseId, i === 0 ? 'contenuti' : 'contenuti (secondo giro)', () =>
            this.generation.enqueueAllContent(ctx, courseId, true),
          );
          if (await this.stopped(tenantId, courseId)) break;
        }
        const left = (await this.generation.remainingWork(tenantId, courseId)).pendingLessons;
        if (left > 0) await this.addIssue(tenantId, courseId, `${left} ${left === 1 ? 'lezione non generata' : 'lezioni non generate'}: riprova dal corso.`);
      }
      // 4. Test ancora mancanti (es. falliti nel lotto dei contenuti).
      if (!(await this.stopped(tenantId, courseId))) {
        await this.setPhase(tenantId, courseId, 'tests');
        if ((await this.generation.remainingWork(tenantId, courseId)).plannedTests > 0) {
          await this.attempt(tenantId, courseId, 'test', () => this.generation.enqueueAllAssessments(ctx, courseId, true));
        }
        const left = (await this.generation.remainingWork(tenantId, courseId)).plannedTests;
        if (left > 0) await this.addIssue(tenantId, courseId, `${left} ${left === 1 ? 'test non generato' : 'test non generati'}: riprova dal corso.`);
      }
      // 5. Copertina.
      if (!(await this.stopped(tenantId, courseId))) {
        await this.setPhase(tenantId, courseId, 'cover');
        const c = await this.prisma.course.findUnique({ where: { id: courseId }, select: { coverImageKey: true } });
        if (!c?.coverImageKey) await this.attempt(tenantId, courseId, 'copertina', () => this.media.generateCourseCover(tenantId, courseId));
      }
      // 6. Componenti scelte nel preventivo.
      if (!(await this.stopped(tenantId, courseId))) {
        await this.setPhase(tenantId, courseId, 'extras');
        await this.runExtras(tenantId, courseId, doc.options);
      }
      const end = await this.load(tenantId, courseId);
      if (end && end.status === 'running') {
        end.status = 'completed';
        end.phase = 'done';
        end.finishedAt = new Date().toISOString();
        end.owner = undefined;
        end.leaseUntil = undefined;
        await this.save(tenantId, courseId, end);
        this.logger.log(`Generazione automatica completata (corso ${courseId}, ${end.issues.length} problemi)`);
      }
    } catch (err) {
      const d = await this.load(tenantId, courseId);
      if (d) {
        d.status = 'failed';
        d.error = errMsg(err);
        const code = (err as { getStatus?: () => number }).getStatus?.() ?? (err as { status?: number }).status;
        if (code === 402) d.errorCode = 'insufficient_credits';
        d.finishedAt = new Date().toISOString();
        d.owner = undefined;
        d.leaseUntil = undefined;
        await this.save(tenantId, courseId, d).catch(() => undefined);
      }
      throw err;
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** Copertine dei moduli, voce narrante e video delle pillole, se scelti. Errori non bloccanti. */
  private async runExtras(tenantId: string, courseId: string, o: CourseEstimateOptions): Promise<void> {
    const mods = await this.prisma.module.findMany({
      where: { courseId },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        coverImageKey: true,
        lessons: { orderBy: { position: 'asc' }, select: { id: true, blocks: true, format: true, videoFirst: true, pillola: true, narrationKey: true } },
      },
    });
    if (o.moduleCovers) {
      for (const m of mods) {
        if (await this.stopped(tenantId, courseId)) return;
        if (!m.coverImageKey) await this.attempt(tenantId, courseId, 'copertina di un modulo', () => this.media.generateModuleCover(tenantId, courseId, m.id), false);
      }
    }
    const lessons = mods.flatMap((m) => m.lessons).filter((l) => Array.isArray(l.blocks) && (l.blocks as unknown[]).length > 0);
    if (o.narration) {
      for (const l of lessons) {
        if (await this.stopped(tenantId, courseId)) return;
        if (!l.narrationKey) await this.attempt(tenantId, courseId, 'voce narrante', () => this.media.generateLessonNarration(tenantId, courseId, l.id), false);
      }
    }
    if (o.lessonVideos) {
      for (const l of lessons) {
        const fmt = resolveLessonLayout({ format: l.format, videoFirst: l.videoFirst, pillola: l.pillola });
        if (fmt !== 'pillola' && fmt !== 'pillola_interattiva') continue;
        const blocks = collectCartoonScenes(l.blocks as unknown[], undefined, undefined, fmt).filter((s) => isPlaceholderVideo(s.media));
        for (const blockId of new Set(blocks.map((s) => s.blockId))) {
          if (await this.stopped(tenantId, courseId)) return;
          // Avvia il rendering in background: il video arriva qualche minuto dopo (stato visibile nel corso).
          await this.attempt(tenantId, courseId, 'video della pillola', () => this.media.generateScenesCartoon(tenantId, courseId, l.id, blockId), false);
        }
      }
    }
  }

  /**
   * Esegue un passo; un errore diventa un problema nel riepilogo invece di fermare tutto. Gli
   * errori di credito (saldo insufficiente, wallet assente) fermano la generazione.
   */
  private async attempt(tenantId: string, courseId: string, what: string, fn: () => Promise<unknown>, fatalOnCredits = true): Promise<void> {
    try {
      await fn();
    } catch (err) {
      const status = (err as { status?: number; getStatus?: () => number }).getStatus?.() ?? (err as { status?: number }).status;
      // Crediti insufficienti o wallet non disponibile: inutile proseguire.
      if (status === 402 || (fatalOnCredits && status === 503)) throw err;
      this.logger.warn(`Generazione automatica (corso ${courseId}): ${what} non riuscita: ${errMsg(err)}`);
      await this.addIssue(tenantId, courseId, `${what[0]!.toUpperCase()}${what.slice(1)} non riuscita: ${shortErr(err)}`);
    }
  }

  private async stopped(tenantId: string, courseId: string): Promise<boolean> {
    const d = await this.load(tenantId, courseId);
    return !d || d.status !== 'running';
  }

  private async setPhase(tenantId: string, courseId: string, phase: AutopilotPhase): Promise<void> {
    const d = await this.load(tenantId, courseId);
    if (!d) return;
    d.phase = phase;
    await this.save(tenantId, courseId, d);
  }

  private async addIssue(tenantId: string, courseId: string, issue: string): Promise<void> {
    const d = await this.load(tenantId, courseId);
    if (!d) return;
    d.issues = [...d.issues, issue].slice(-20);
    await this.save(tenantId, courseId, d);
  }

  private async touch(tenantId: string, courseId: string): Promise<void> {
    const d = await this.load(tenantId, courseId);
    if (!d || d.status !== 'running') return;
    d.leaseUntil = Date.now() + LEASE_MS;
    await this.save(tenantId, courseId, d);
  }

  private async load(tenantId: string, courseId: string): Promise<AutopilotDoc | null> {
    const c = await this.prisma.course.findFirst({ where: { id: courseId, tenantId }, select: { autopilot: true } });
    return (c?.autopilot as AutopilotDoc | null) ?? null;
  }

  private async save(tenantId: string, courseId: string, doc: AutopilotDoc): Promise<void> {
    doc.updatedAt = new Date().toISOString();
    await this.tenantPrisma.runInTenant(tenantId, (tx) =>
      tx.course.updateMany({ where: { id: courseId, tenantId }, data: { autopilot: doc as unknown as object } }),
    );
  }

  /** Vista con l'avanzamento calcolato sullo stato reale del corso. */
  private async view(tenantId: string, courseId: string, doc: AutopilotDoc): Promise<AutopilotView> {
    const [mods, assessments, course, remaining] = await Promise.all([
      this.prisma.module.findMany({
        where: { courseId },
        orderBy: { position: 'asc' },
        select: {
          lessons: {
            orderBy: { position: 'asc' },
            select: { title: true, blocks: true, format: true, videoFirst: true, pillola: true, narrationKey: true },
          },
        },
      }),
      this.prisma.assessment.count({ where: { courseId } }),
      this.prisma.course.findUnique({ where: { id: courseId }, select: { coverImageKey: true } }),
      this.generation.remainingWork(tenantId, courseId),
    ]);
    const lessons = mods.flatMap((m) => m.lessons);
    const withContent = lessons.filter((l) => Array.isArray(l.blocks) && (l.blocks as unknown[]).length > 0);
    const videos = { done: 0, processing: 0, pending: 0 };
    for (const l of withContent) {
      const fmt = resolveLessonLayout({ format: l.format, videoFirst: l.videoFirst, pillola: l.pillola });
      if (fmt !== 'pillola' && fmt !== 'pillola_interattiva') continue;
      for (const s of collectCartoonScenes(structuredClone(l.blocks as unknown[]), undefined, undefined, fmt)) {
        const m = s.media as { storageKey?: string; videoGenStatus?: string };
        if (m.storageKey) videos.done++;
        else if (m.videoGenStatus === 'processing') videos.processing++;
        else videos.pending++;
      }
    }
    return {
      status: doc.status,
      phase: doc.phase,
      reviewStructure: doc.reviewStructure,
      options: doc.options,
      startedAt: doc.startedAt,
      updatedAt: doc.updatedAt,
      ...(doc.finishedAt ? { finishedAt: doc.finishedAt } : {}),
      issues: doc.issues,
      ...(doc.error ? { error: doc.error } : {}),
      ...(doc.errorCode ? { errorCode: doc.errorCode } : {}),
      progress: {
        lessons: { done: withContent.length, total: lessons.length },
        lessonItems: lessons.map((l) => ({
          title: l.title,
          format: resolveLessonLayout({ format: l.format, videoFirst: l.videoFirst, pillola: l.pillola }),
          done: Array.isArray(l.blocks) && (l.blocks as unknown[]).length > 0,
        })),
        tests: { done: assessments, total: assessments + remaining.plannedTests },
        cover: Boolean(course?.coverImageKey),
        videos,
        narration: { done: withContent.filter((l) => l.narrationKey).length, total: doc.options.narration ? withContent.length : 0 },
      },
    };
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Messaggio breve per il riepilogo (senza dettagli tecnici lunghi). */
function shortErr(err: unknown): string {
  const m = errMsg(err).replace(/^API \d+:\s*/, '');
  return m.length > 140 ? `${m.slice(0, 139)}…` : m;
}
