import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Brief,
  CourseOutline,
  Block,
  Assessment,
  BrandVoice,
  outlineJsonSchema,
  blockJsonSchema,
  assessmentJsonSchema,
  CONTRACTS_VERSION,
  type CourseOutline as CourseOutlineType,
  type Block as BlockType,
  type Assessment as AssessmentType,
  type BrandVoice as BrandVoiceType,
} from '@scorm/contracts';
import { z } from 'zod';
import type { JobQueue, LLMProvider, RequestContext } from '@scorm/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { JOB_QUEUE, LLM_PROVIDER } from '../providers/provider.constants.js';
import { ModulesService } from '../courses/modules.service.js';
import { MediaService } from './media.service.js';
import { UsageMeterService } from '../metering/usage-meter.service.js';
import { RetrievalService } from '../knowledge/retrieval.service.js';
import { buildRetrievalQuery } from '../knowledge/query-builder.js';
import {
  assessmentPrompt,
  formatContext,
  lessonContentPrompt,
  outlinePrompt,
  systemPrompt,
} from './prompts.js';

const BlockArray = z.array(Block);

/** Sottoinsieme di JobType gestito dalla generazione AI. */
export type GenJobType =
  | 'course.generate_outline'
  | 'course.generate_content'
  | 'course.generate_all_content'
  | 'course.generate_assessment';

/** Parametri trasportati nel payload del job (oltre al jobId). */
export interface GenJobPayload {
  courseId: string;
  lessonId?: string;
  toneInstruction?: string;
  scope?: 'intermediate' | 'final';
  focus?: string;
  /** Modulo di riferimento per i test intermedi (serve al gating). */
  moduleId?: string;
}

type GenJobPayloadWithId = GenJobPayload & { jobId: string };

/** Vista dello stato di un job per il client (polling). */
export interface GenJobView {
  id: string;
  type: string;
  status: string;
  /** Lezione associata (per i job per-lezione), per ricollegare lo stato UI. */
  lessonId?: string;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

/**
 * Orchestratore della generazione AI (Requisito 4). Ogni fase (outline,
 * contenuti lezione, assessment) è tracciata da un GenerationJob con audit di
 * modello/token/correlationId (Requisito 4.7 / 11), usa la generazione
 * strutturata del LLMProvider (output conforme agli schema) ed è ancorata al
 * contesto RAG con citazioni quando disponibile.
 */
@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    private readonly retrieval: RetrievalService,
    private readonly modules: ModulesService,
    private readonly media: MediaService,
    private readonly meter: UsageMeterService,
  ) {}

  // === Accodamento (API) ====================================================
  // Gli endpoint non eseguono più il modello dentro la request: creano un
  // GenerationJob in stato QUEUED, lo accodano e ritornano subito { jobId }.
  // Il worker (handler registrati in GenerationModule) esegue runOutline/
  // runLessonContent/runAssessment e aggiorna il job a COMPLETED/FAILED.

  /** Accoda la generazione dell'outline. Ritorna il jobId per il polling. */
  async enqueueOutline(ctx: RequestContext, courseId: string): Promise<{ jobId: string }> {
    await this.requireCourse(ctx.tenant.tenantId, courseId);
    return this.enqueue(ctx, courseId, 'course.generate_outline', { courseId });
  }

  /** Accoda la generazione dei contenuti di una lezione. */
  async enqueueLessonContent(
    ctx: RequestContext,
    courseId: string,
    lessonId: string,
    toneInstruction?: string,
  ): Promise<{ jobId: string }> {
    await this.requireCourse(ctx.tenant.tenantId, courseId);
    return this.enqueue(ctx, courseId, 'course.generate_content', {
      courseId,
      lessonId,
      toneInstruction,
    });
  }

  /** Accoda la generazione di un assessment. */
  async enqueueAssessment(
    ctx: RequestContext,
    courseId: string,
    scope: 'intermediate' | 'final',
    focus: string,
    moduleId?: string,
  ): Promise<{ jobId: string }> {
    await this.requireCourse(ctx.tenant.tenantId, courseId);
    return this.enqueue(ctx, courseId, 'course.generate_assessment', { courseId, scope, focus, moduleId });
  }

  /**
   * Crea il record GenerationJob (QUEUED) e lo accoda. Il payload trasporta i
   * parametri necessari al worker. Il jobId del DB è usato anche come id logico.
   */
  private async enqueue(
    ctx: RequestContext,
    courseId: string,
    type: GenJobType,
    payload: GenJobPayload,
  ): Promise<{ jobId: string }> {
    const jobId = randomUUID();
    await this.prisma.generationJob.create({
      data: {
        id: jobId,
        tenantId: ctx.tenant.tenantId,
        courseId,
        // Persistito per ricollegare il job alla lezione dopo un reload UI.
        lessonId: payload.lessonId ?? null,
        type,
        status: 'QUEUED',
        correlationId: ctx.correlationId,
        // Snapshot dei parametri per audit/ripresa (es. toneInstruction, scope).
        params: payload as unknown as object,
      },
    });
    await this.jobs.enqueue(type, { ...payload, jobId }, ctx);
    return { jobId };
  }

  /**
   * Accoda la generazione dei contenuti di TUTTE le lezioni ancora vuote con un
   * UNICO job batch eseguito interamente lato server (immune a reload/chiusura
   * del browser). Il worker itera le lezioni pending generandole in sequenza.
   */
  async enqueueAllContent(ctx: RequestContext, courseId: string): Promise<{ jobId: string }> {
    await this.requireCourse(ctx.tenant.tenantId, courseId);
    return this.enqueue(ctx, courseId, 'course.generate_all_content', { courseId });
  }

  /** Stato di un job (per il polling del client). Isolato per tenant. */
  async getJob(tenantId: string, courseId: string, jobId: string): Promise<GenJobView> {
    const job = await this.prisma.generationJob.findFirst({
      where: { id: jobId, tenantId, courseId },
    });
    if (!job) throw new NotFoundException('Job non trovato');
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      lessonId: job.lessonId ?? undefined,
      error: job.error ?? undefined,
      createdAt: job.createdAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString(),
    };
  }

  /**
   * Recupero all'avvio: un restart lascia job QUEUED/RUNNING "orfani" (con la
   * coda in-memory i messaggi non sopravvivono al riavvio; con SQS il worker
   * potrebbe non essere ripartito). Li marca FAILED così l'UI smette di fare
   * polling su job che non progrediranno più. Soglia: job più vecchi di
   * `staleAfterMs` (default 2 min: oltre la durata tipica di una generazione).
   */
  async recoverStaleJobs(staleAfterMs = 2 * 60_000): Promise<number> {
    const threshold = new Date(Date.now() - staleAfterMs);
    const res = await this.prisma.generationJob.updateMany({
      where: {
        status: { in: ['QUEUED', 'RUNNING'] },
        createdAt: { lt: threshold },
      },
      data: {
        status: 'FAILED',
        error: 'Job interrotto (riavvio del servizio): rilancia la generazione.',
        finishedAt: new Date(),
      },
    });
    if (res.count > 0) {
      this.logger.warn(`Recupero job orfani all'avvio: ${res.count} marcati FAILED`);
    }
    return res.count;
  }

  /** Job attivi (QUEUED/RUNNING) o recenti del corso, per riflettere lo stato UI. */
  async listActiveJobs(tenantId: string, courseId: string): Promise<GenJobView[]> {
    const rows = await this.prisma.generationJob.findMany({
      where: { tenantId, courseId, status: { in: ['QUEUED', 'RUNNING'] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((job) => ({
      id: job.id,
      type: job.type,
      status: job.status,
      lessonId: job.lessonId ?? undefined,
      error: job.error ?? undefined,
      createdAt: job.createdAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString(),
    }));
  }

  /**
   * Elenco tenant-wide dei corsi con generazione attiva (QUEUED/RUNNING),
   * aggregato per corso. Alimenta il badge "in generazione" nella lista corsi
   * e altrove, senza dover interrogare corso per corso.
   */
  async listActiveCourseIds(tenantId: string): Promise<Array<{ courseId: string; jobs: number }>> {
    const rows = await this.prisma.generationJob.groupBy({
      by: ['courseId'],
      where: { tenantId, status: { in: ['QUEUED', 'RUNNING'] }, courseId: { not: null } },
      _count: { _all: true },
    });
    return rows
      .filter((r): r is typeof r & { courseId: string } => r.courseId !== null)
      .map((r) => ({ courseId: r.courseId, jobs: r._count._all }));
  }

  // === Esecuzione (worker) ==================================================
  // Eseguiti dagli handler della coda. Avvolgono la logica di generazione in
  // executeJob, che segna il job RUNNING→COMPLETED/FAILED.

  /** Dispatch del worker per i job di generazione. */
  async handleJob(payload: GenJobPayloadWithId & { type: GenJobType }, ctx: RequestContext): Promise<void> {
    switch (payload.type) {
      case 'course.generate_outline':
        await this.executeJob(payload.jobId, () => this.runOutline(ctx, payload.courseId, payload.jobId));
        break;
      case 'course.generate_content':
        await this.executeJob(payload.jobId, () =>
          this.runLessonContent(ctx, payload.courseId, payload.lessonId!, payload.toneInstruction, payload.jobId),
        );
        break;
      case 'course.generate_all_content':
        await this.executeJob(payload.jobId, () => this.runAllContent(ctx, payload.courseId, payload.jobId));
        break;
      case 'course.generate_assessment':
        await this.executeJob(payload.jobId, () =>
          this.runAssessment(ctx, payload.courseId, payload.scope!, payload.focus ?? '', payload.jobId, payload.moduleId),
        );
        break;
      default:
        break;
    }
  }

  /**
   * Esegue la funzione di generazione marcando il job RUNNING, poi COMPLETED o
   * FAILED. L'audit di modello/token è aggiornato dentro le run* via recordUsage.
   */
  private async executeJob(jobId: string, fn: () => Promise<unknown>): Promise<void> {
    await this.prisma.generationJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    try {
      await fn();
      await this.prisma.generationJob.update({
        where: { id: jobId },
        data: { status: 'COMPLETED', finishedAt: new Date() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Errore sconosciuto';
      await this.prisma.generationJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', error: message, finishedAt: new Date() },
      });
      this.logger.error(`Generazione job ${jobId} fallita: ${message}`);
      // Rilancia: la coda (SQS) applicherà il retry/DLQ.
      throw err;
    }
  }

  /**
   * Registra l'audit di usage/modello sul job E il metering costi (un
   * UsageRecord per i token input e uno per gli output). I token sul job sono
   * SOMMATI (non sovrascritti): una fase può fare più chiamate LLM.
   */
  private async recordUsage(opts: {
    tenantId: string;
    courseId: string;
    jobId?: string;
    usage: { inputTokens: number; outputTokens: number };
    model: string;
    source: string;
  }): Promise<void> {
    const { tenantId, courseId, jobId, usage, model, source } = opts;
    if (jobId) {
      // Somma incrementale: increment è atomico lato DB.
      await this.prisma.generationJob.update({
        where: { id: jobId },
        data: {
          model,
          inputTokens: { increment: usage.inputTokens },
          outputTokens: { increment: usage.outputTokens },
        },
      });
    }
    // Metering costi (fire-and-forget: non blocca la pipeline di generazione).
    void this.meter.record({
      tenantId,
      courseId,
      jobId: jobId ?? null,
      provider: 'BEDROCK_LLM',
      model,
      unit: 'INPUT_TOKENS',
      quantity: usage.inputTokens,
      source,
    });
    void this.meter.record({
      tenantId,
      courseId,
      jobId: jobId ?? null,
      provider: 'BEDROCK_LLM',
      model,
      unit: 'OUTPUT_TOKENS',
      quantity: usage.outputTokens,
      source,
    });
  }

  // --- Fase 1: outline ------------------------------------------------------

  private async runOutline(ctx: RequestContext, courseId: string, jobId?: string): Promise<CourseOutlineType> {
    const course = await this.requireCourse(ctx.tenant.tenantId, courseId);
    const brief = Brief.parse(course.brief);
    const voice = await this.brandVoice(ctx.tenant.tenantId, brief.brandIds);

    // RAG: recupera contesto pertinente agli obiettivi del corso.
    const query = buildRetrievalQuery({
      objective: brief.learningObjectives.join('; '),
      courseTitle: brief.title,
      audience: brief.targetAudience,
    });
    const retrieved = await this.retrieval.retrieve({
      tenantId: ctx.tenant.tenantId,
      courseId,
      text: query,
      documentIds: brief.knowledgeDocIds,
    });

    const result = await this.llm.generate({
      system: systemPrompt(voice),
      messages: [{ role: 'user', content: outlinePrompt(brief, formatContext(retrieved.chunks)) }],
      schema: outlineJsonSchema as Record<string, unknown>,
      temperature: 0.4,
      // Spazio ampio: Claude Sonnet 4.6 è più verboso e con 4000 troncava il
      // JSON tool-use (stop=max_tokens) lasciando `modules` incompleto/assente.
      maxTokens: 8000,
    });
    const outline = CourseOutline.parse(JSON.parse(result.text));
    await this.recordUsage({
      tenantId: ctx.tenant.tenantId,
      courseId,
      jobId,
      usage: result.usage,
      model: result.model,
      source: 'outline',
    });

    await this.prisma.course.update({
      where: { id: courseId },
      data: { outline: outline as object },
    });

    // Materializzazione automatica: crea subito moduli/lezioni dall'outline, così
    // la struttura è pronta senza un passo manuale. Idempotente: non duplica e
    // non sovrascrive contenuti già prodotti (resta modificabile dopo).
    await this.modules.materializeOutline(ctx.tenant.tenantId, courseId);

    return outline;
  }

  // --- Fase 2: contenuti di una lezione -------------------------------------

  private async runLessonContent(
    ctx: RequestContext,
    courseId: string,
    lessonId: string,
    toneInstruction?: string,
    jobId?: string,
    /** Se true, NON genera le immagini (saranno lanciate in batch dal caller). */
    skipImages = false,
  ): Promise<{ blocks: BlockType[]; lessonId: string; autoImages: boolean }> {
    const course = await this.requireCourse(ctx.tenant.tenantId, courseId);
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, module: { courseId } },
      include: { module: true },
    });
    if (!lesson) throw new NotFoundException('Lezione non trovata');

    const brief = course.brief ? Brief.safeParse(course.brief) : null;
    // Video-first: flag della lezione, o forzato dal brief video-first.
    const videoFirst =
      lesson.videoFirst === true || (brief?.success ? brief.data.videoFirst === true : false);
    const voice = await this.brandVoice(
      ctx.tenant.tenantId,
      brief?.success ? brief.data.brandIds : [],
    );
    const objectives = Array.isArray(lesson.objectives) ? (lesson.objectives as string[]) : [];

    const retrieved = await this.retrieval.retrieve({
      tenantId: ctx.tenant.tenantId,
      courseId,
      text: buildRetrievalQuery({ objective: objectives.join('; ') || lesson.title, courseTitle: course.title }),
      documentIds: brief?.success ? brief.data.knowledgeDocIds : undefined,
    });

    const result = await this.llm.generate({
      system: systemPrompt(voice),
      messages: [
        {
          role: 'user',
          content: lessonContentPrompt({
            courseTitle: course.title,
            moduleTitle: lesson.module.title,
            lessonTitle: lesson.title,
            objectives,
            language: course.language,
            context: formatContext(retrieved.chunks),
            toneInstruction,
            videoFirst,
          }),
        },
      ],
      // Lo schema di un singolo Block guida il modello; ne richiediamo un array
      // avvolgendolo in un oggetto per la generazione strutturata.
      schema: wrapArraySchema(blockJsonSchema, 'blocks'),
      temperature: 0.6,
      // Contenuti didattici approfonditi: ampio spazio di output per evitare
      // troncamenti del JSON tool-use (Claude Sonnet 4.5 supporta output grandi).
      maxTokens: 16000,
    });
    // Un output troncato (limite token) produce JSON tool-use incompleto:
    // meglio fallire il job che salvare contenuti vuoti/corrotti.
    if (result.finishReason === 'max_tokens') {
      throw new Error('Generazione contenuti troncata (limite token): riprova.');
    }
    const payload = JSON.parse(result.text) as { blocks?: unknown };
    const blocks = BlockArray.parse(payload.blocks ?? []);
    if (blocks.length === 0) {
      throw new Error('Il modello non ha prodotto block validi.');
    }
    await this.recordUsage({
      tenantId: ctx.tenant.tenantId,
      courseId,
      jobId,
      usage: result.usage,
      model: result.model,
      source: 'lesson_content',
    });

    // Attacca le citazioni delle fonti al materiale editoriale di ciascun block.
    const withCitations = blocks.map((b) => ({
      ...b,
      editorial: { ...b.editorial, citations: retrieved.citations },
    }));

    await this.prisma.lesson.update({
      where: { id: lessonId },
      data: { blocks: withCitations as object, schemaVersion: CONTRACTS_VERSION },
    });

    // Immagini automatiche: scorporate dalla generazione dei contenuti e lanciate
    // come task parallele DOPO il salvataggio dei block. Questo evita che la
    // latenza delle immagini (Stability/Bedrock) si sommi a quella del testo
    // LLM. Le immagini restano best-effort: un errore non invalida i contenuti.
    // In modalità batch (runAllContent) le immagini di tutte le lezioni vengono
    // raccolte e lanciate in parallelo alla fine, per massimo throughput.
    const autoImages = brief?.success ? brief.data.autoGenerateImages !== false : true;
    const wantsImages = autoImages && !skipImages;
    if (wantsImages) {
      // Chiamata singola (non batch): genera immagini subito (best-effort).
      try {
        await this.media.generateLessonImages(ctx.tenant.tenantId, courseId, lessonId);
      } catch (err) {
        this.logger.warn(
          `Immagini automatiche non generate (lezione ${lessonId}): ${err instanceof Error ? err.message : 'errore'}`,
        );
      }
    }
    return { blocks: withCitations, lessonId, autoImages };
  }

  // --- Fase 2b: contenuti di TUTTE le lezioni (batch server-side) ------------

  /** Limite di concorrenza per le chiamate LLM nel batch: evita di saturare
   *  Bedrock e mantiene la latenza sotto controllo. 3 è un buon compromesso
   *  tra velocità e rate limit (Bedrock ha ~20 req/s su Sonnet). */
  private static readonly BATCH_CONCURRENCY = 3;

  /**
   * Genera i contenuti di tutte le lezioni ancora vuote del corso, con
   * **parallelismo controllato** (BATCH_CONCURRENCY lezioni alla volta).
   * Le lezioni sono indipendenti: ogni prompt riceve solo titolo+obiettivi+
   * contesto RAG, non il contenuto delle altre lezioni → parallelizzabili
   * senza perdita di qualità.
   *
   * Le immagini automatiche sono scorporate: vengono raccolte e generate in
   * parallelo DOPO tutti i contenuti testuali, così non bloccano la pipeline.
   *
   * Aggiorna il progress sul job (params JSONB) a ogni lezione completata,
   * così il client può mostrare "3 di 8 lezioni generate".
   */
  private async runAllContent(ctx: RequestContext, courseId: string, jobId?: string): Promise<void> {
    const modules = await this.prisma.module.findMany({
      where: { courseId },
      orderBy: { position: 'asc' },
      include: { lessons: { orderBy: { position: 'asc' } } },
    });
    // Solo le lezioni ancora senza contenuti (idempotente: rilanciabile).
    const pending = modules
      .flatMap((m) => m.lessons)
      .filter((l) => !Array.isArray(l.blocks) || (l.blocks as unknown[]).length === 0);

    const total = pending.length;
    let done = 0;
    const failures: string[] = [];
    // Lezioni che necessitano di immagini (raccolte per il batch finale).
    const imageQueue: Array<{ lessonId: string }> = [];

    // Progress iniziale.
    if (jobId) {
      await this.updateJobProgress(jobId, { lessonsDone: 0, lessonsTotal: total });
    }

    // Esecuzione parallela a batch con concurrency limit.
    const concurrency = GenerationService.BATCH_CONCURRENCY;
    for (let i = 0; i < total; i += concurrency) {
      const batch = pending.slice(i, i + concurrency);
      this.logger.log(
        `Batch ${Math.floor(i / concurrency) + 1}: avvio ${batch.length} lezioni in parallelo (${batch.map((l) => l.title.slice(0, 25)).join(', ')})`,
      );
      const batchStart = Date.now();
      const results = await Promise.allSettled(
        batch.map(async (lesson) => {
          const start = Date.now();
          this.logger.log(`  → Lezione "${lesson.title.slice(0, 30)}" avviata`);
          // skipImages=true: le immagini le facciamo dopo in parallelo.
          const res = await this.runLessonContent(ctx, courseId, lesson.id, undefined, jobId, true);
          this.logger.log(`  ✓ Lezione "${lesson.title.slice(0, 30)}" completata in ${((Date.now() - start) / 1000).toFixed(1)}s`);
          return { lessonId: lesson.id, autoImages: res.autoImages };
        }),
      );
      for (let j = 0; j < results.length; j++) {
        const r = results[j]!;
        if (r.status === 'fulfilled') {
          done++;
          if (r.value.autoImages) imageQueue.push({ lessonId: r.value.lessonId });
        } else {
          const msg = r.reason instanceof Error ? r.reason.message : 'errore';
          this.logger.warn(`Batch: lezione ${batch[j]!.id} non generata: ${msg}`);
          failures.push(`${batch[j]!.title}: ${msg}`);
        }
      }
      // Aggiorna il progress dopo ogni batch.
      this.logger.log(
        `Batch ${Math.floor(i / concurrency) + 1} completato in ${((Date.now() - batchStart) / 1000).toFixed(1)}s — ${done}/${total} lezioni pronte`,
      );
      if (jobId) {
        await this.updateJobProgress(jobId, { lessonsDone: done, lessonsTotal: total });
      }
    }

    // Immagini automatiche: generate in parallelo DOPO tutti i contenuti testuali.
    // Best-effort: un errore non cambia lo stato del job.
    if (imageQueue.length > 0) {
      this.logger.log(`Batch immagini: ${imageQueue.length} lezioni da illustrare`);
      await Promise.allSettled(
        imageQueue.map(({ lessonId }) =>
          this.media.generateLessonImages(ctx.tenant.tenantId, courseId, lessonId).catch((err) => {
            this.logger.warn(
              `Immagini batch (lezione ${lessonId}): ${err instanceof Error ? err.message : 'errore'}`,
            );
          }),
        ),
      );
    }

    this.logger.log(`Batch contenuti corso ${courseId}: ${done}/${total} completate`);

    // Assessment automatici: se l'outline prevede test intermedi o finali e non
    // sono ancora stati creati, li genera ora (dopo i contenuti). Così il brief
    // con `requestedAssessments: ["intermediate"]` produce realmente i test
    // senza richiedere un'azione manuale separata. Best-effort.
    try {
      await this.autoGenerateAssessments(ctx, courseId, jobId);
    } catch (err) {
      this.logger.warn(
        `Assessment automatici non generati: ${err instanceof Error ? err.message : 'errore'}`,
      );
    }

    if (failures.length > 0) {
      throw new Error(
        `Generazione completata con errori su ${failures.length} lezioni: ${failures
          .slice(0, 3)
          .join(' | ')}${failures.length > 3 ? '…' : ''}`,
      );
    }
  }

  /** Aggiorna il progress del batch nel campo params (JSONB) del job. */
  private async updateJobProgress(jobId: string, progress: { lessonsDone: number; lessonsTotal: number }): Promise<void> {
    try {
      const job = await this.prisma.generationJob.findUnique({ where: { id: jobId }, select: { params: true } });
      const params = (job?.params && typeof job.params === 'object' ? job.params : {}) as Record<string, unknown>;
      await this.prisma.generationJob.update({
        where: { id: jobId },
        data: { params: { ...params, ...progress } },
      });
    } catch {
      // Best-effort: non blocca la generazione.
    }
  }

  // --- Assessment automatici dal batch "genera tutto" ----------------------

  /**
   * Genera automaticamente gli assessment previsti dall'outline (intermedi e/o
   * finali) che non sono ancora presenti nel DB. Chiamato alla fine di
   * runAllContent, così il brief che chiede test intermedi li ottiene realmente
   * senza un'azione manuale separata. Best-effort: se un assessment fallisce
   * non blocca il completamento del batch.
   */
  private async autoGenerateAssessments(
    ctx: RequestContext,
    courseId: string,
    jobId?: string,
  ): Promise<void> {
    const course = await this.requireCourse(ctx.tenant.tenantId, courseId);
    const parsed = course.outline ? CourseOutline.safeParse(course.outline) : null;
    if (!parsed?.success) return;

    // Assessment già presenti (non duplichiamo).
    const existing = await this.prisma.assessment.findMany({
      where: { courseId },
      select: { scope: true, moduleId: true },
    });
    const existingSet = new Set(existing.map((a) => `${a.scope}:${a.moduleId ?? 'final'}`));

    // Moduli del DB per collegare moduleId agli assessment intermedi.
    const modules = await this.prisma.module.findMany({
      where: { courseId },
      orderBy: { position: 'asc' },
      select: { id: true, title: true },
    });

    const tasks: Array<{
      scope: 'intermediate' | 'final';
      focus: string;
      moduleTitle: string;
      moduleId?: string;
    }> = [];

    for (let i = 0; i < parsed.data.modules.length; i++) {
      const mo = parsed.data.modules[i]!;
      if (mo.hasIntermediateAssessment && modules[i]) {
        const key = `INTERMEDIATE:${modules[i]!.id}`;
        if (!existingSet.has(key)) {
          tasks.push({
            scope: 'intermediate',
            focus: `Modulo "${mo.title}": ${mo.lessons.map((l) => l.title).join(', ')}`,
            moduleTitle: mo.title,
            // Collega il test intermedio al suo modulo: senza moduleId lo step
            // non entra nella sequenza del player e il gating non si attiva.
            moduleId: modules[i]!.id,
          });
        }
      }
    }
    if (parsed.data.hasFinalAssessment && !existingSet.has('FINAL:final')) {
      tasks.push({
        scope: 'final',
        focus: `Intero corso "${parsed.data.title}": ${parsed.data.modules.map((m) => m.title).join(', ')}`,
        moduleTitle: '',
      });
    }

    if (tasks.length === 0) return;

    this.logger.log(`Assessment automatici: ${tasks.length} da generare`);
    for (const task of tasks) {
      try {
        await this.runAssessment(ctx, courseId, task.scope, task.focus, jobId, task.moduleId);
        this.logger.log(`  ✓ Assessment ${task.scope} "${task.moduleTitle || 'finale'}" generato`);
      } catch (err) {
        this.logger.warn(
          `  ✗ Assessment ${task.scope} "${task.moduleTitle || 'finale'}": ${err instanceof Error ? err.message : 'errore'}`,
        );
      }
    }
  }

  // --- Fase 3: assessment ---------------------------------------------------

  private async runAssessment(
    ctx: RequestContext,
    courseId: string,
    scope: 'intermediate' | 'final',
    focus: string,
    jobId?: string,
    moduleId?: string,
  ): Promise<AssessmentType> {
    const course = await this.requireCourse(ctx.tenant.tenantId, courseId);
    const brief = course.brief ? Brief.safeParse(course.brief) : null;
    const voice = await this.brandVoice(
      ctx.tenant.tenantId,
      brief?.success ? brief.data.brandIds : [],
    );
    const retrieved = await this.retrieval.retrieve({
      tenantId: ctx.tenant.tenantId,
      courseId,
      text: buildRetrievalQuery({ objective: focus, courseTitle: course.title }),
      documentIds: brief?.success ? brief.data.knowledgeDocIds : undefined,
    });

    const result = await this.llm.generate({
      system: systemPrompt(voice),
      messages: [
        {
          role: 'user',
          content: assessmentPrompt({
            courseTitle: course.title,
            scope,
            focus,
            language: course.language,
            context: formatContext(retrieved.chunks),
          }),
        },
      ],
      schema: assessmentJsonSchema as Record<string, unknown>,
      temperature: 0.5,
      // Margine ampio per evitare troncamenti del JSON tool-use con Sonnet 4.6.
      maxTokens: 8000,
    });
    const assessment = Assessment.parse(JSON.parse(result.text));
    await this.recordUsage({
      tenantId: ctx.tenant.tenantId,
      courseId,
      jobId,
      usage: result.usage,
      model: result.model,
      source: 'assessment',
    });

    // Persiste l'assessment generato come entità Assessment + Question, così da
    // renderlo disponibile a editor ed export (Requisito 6). Lo scope del
    // contratto (lowercase) è mappato all'enum del DB (uppercase).
    // Per i test intermedi collega il moduleId del modulo di riferimento (noto
    // dal contesto di generazione), così lo step entra nella sequenza e fa da
    // gate. L'LLM non popola moduleId: lo impone il backend.
    await this.persistAssessment(courseId, assessment, scope === 'intermediate' ? moduleId : undefined);
    return assessment;
  }

  /** Salva l'assessment generato e le sue domande come entità del dominio. */
  private async persistAssessment(
    courseId: string,
    assessment: AssessmentType,
    moduleId?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.assessment.create({
        data: {
          courseId,
          title: assessment.title,
          scope: assessment.scope === 'final' ? 'FINAL' : 'INTERMEDIATE',
          moduleId: moduleId ?? null,
          masteryScore: assessment.masteryScore,
          maxAttempts: assessment.maxAttempts,
          shuffleQuestions: assessment.shuffleQuestions,
          shuffleAnswers: assessment.shuffleAnswers,
        },
      });
      for (let i = 0; i < assessment.questions.length; i++) {
        const q = assessment.questions[i]!;
        await tx.question.create({
          data: {
            assessmentId: created.id,
            type: q.type,
            position: i,
            points: q.points,
            payload: q as object,
            schemaVersion: CONTRACTS_VERSION,
          },
        });
      }
    });
  }

  // --- Infrastruttura comune ------------------------------------------------

  private async requireCourse(tenantId: string, courseId: string) {
    const course = await this.prisma.course.findFirst({ where: { id: courseId, tenantId } });
    if (!course) throw new NotFoundException('Corso non trovato');
    return course;
  }

  /** Recupera il tono di voce dal primo brand associato, se presente. */
  private async brandVoice(tenantId: string, brandIds?: string[]): Promise<BrandVoiceType | undefined> {
    if (!brandIds || brandIds.length === 0) return undefined;
    const brand = await this.prisma.brand.findFirst({
      where: { tenantId, id: { in: brandIds } },
    });
    if (!brand) return undefined;
    const def = brand.definition as { voice?: unknown };
    const parsed = def.voice ? BrandVoice.safeParse(def.voice) : null;
    return parsed && parsed.success ? parsed.data : undefined;
  }
}

/**
 * Avvolge lo schema di un elemento in un oggetto { [key]: elemento[] }, per
 * ottenere dal modello un array strutturato tramite tool-use.
 */
function wrapArraySchema(itemSchema: object, key: string): Record<string, unknown> {
  return {
    type: 'object',
    properties: { [key]: { type: 'array', items: itemSchema } },
    required: [key],
    additionalProperties: false,
  };
}
