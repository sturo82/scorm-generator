import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  Assessment,
  assessmentJsonSchema,
  computeSlideTimeline,
  globalCues,
  type Block,
  type SlideVideoLayout,
} from '@scorm/contracts';
import type { LLMProvider, ObjectStorage } from '@scorm/domain';
import type { AppConfig } from '../config/configuration.js';
import { ModulesService } from '../courses/modules.service.js';
import { assessmentPrompt, systemPrompt } from '../generation/prompts.js';
import { UsageMeterService } from '../metering/usage-meter.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LLM_PROVIDER, OBJECT_STORAGE } from '../providers/provider.constants.js';
import { buildSlideVideoSpec } from './slide-assembly.js';
import { SlideClipsService } from './slide-clips.service.js';
import { SlideScriptsService } from './slide-scripts.service.js';
import { SlidesService } from './slides.service.js';

const MEDIA_URL_TTL_SEC = 3 * 3600;
const LEASE_MS = 90_000;
const HEARTBEAT_MS = 30_000;

type Step = 'render' | 'summary' | 'lesson' | 'quiz' | 'done';

export interface SlideLessonDoc {
  importId: string;
  courseId: string;
  status: 'running' | 'completed' | 'failed';
  step: Step;
  error?: string;
  layout: SlideVideoLayout;
  moduleTitle: string;
  /** Avanzamento persistito: ogni passo completato non si ripete dopo un riavvio. */
  videoKey?: string;
  videoDurationSec?: number;
  summaryHtml?: string;
  keyPointsHtml?: string;
  moduleId?: string;
  lessonId?: string;
  /** True quando i blocchi della lezione sono stati scritti (lessonId può esistere prima). */
  lessonReady?: boolean;
  assessmentId?: string;
  /** True quando tutte le domande del quiz sono state salvate. */
  quizReady?: boolean;
  createdAt: string;
  updatedAt: string;
  owner?: string;
  leaseUntil?: number;
}

export type SlideLessonView = Omit<SlideLessonDoc, 'owner' | 'leaseUntil'>;

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Riepilogo scritto in HTML semplice (<p>, <ul>, <li>, <strong>).' },
    keyPoints: { type: 'array', items: { type: 'string' }, description: 'Da 4 a 7 punti chiave, una frase ciascuno.' },
  },
  required: ['summary', 'keyPoints'],
  additionalProperties: false,
} as const;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Fase finale della pipeline "slide + avatar": monta il video (Remotion), scrive
 * riepilogo e quiz a partire dai copioni approvati e crea modulo + lezione
 * video-first con trascrizione. Lo stato (con i passi già completati) vive in
 * `lesson.json` accanto all'import: dopo un riavvio si riprende dal passo
 * successivo senza rifare render o chiamate LLM già fatte.
 */
@Injectable()
export class SlideLessonService {
  private readonly logger = new Logger(SlideLessonService.name);
  private readonly instanceId = randomUUID();
  private readonly active = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly slides: SlidesService,
    private readonly scripts: SlideScriptsService,
    private readonly clips: SlideClipsService,
    private readonly modules: ModulesService,
    private readonly meter: UsageMeterService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
  ) {}

  private docKey(tenantId: string, courseId: string, importId: string): string {
    return `media/${tenantId}/${courseId}/slides/${importId}/lesson.json`;
  }
  private runKey(tenantId: string, importId: string): string {
    return `${tenantId}:${importId}`;
  }

  async start(
    tenantId: string,
    courseId: string,
    importId: string,
    input: { layout?: SlideVideoLayout; moduleTitle?: string },
  ): Promise<SlideLessonView> {
    const clipsView = await this.clips.status(tenantId, courseId, importId);
    if (!clipsView || clipsView.status !== 'completed') {
      throw new ConflictException('Le clip avatar non sono tutte pronte.');
    }
    const existing = await this.load(tenantId, courseId, importId);
    if (existing?.status === 'running' && (existing.leaseUntil ?? 0) > Date.now()) {
      throw new ConflictException('Montaggio già in corso.');
    }
    if (existing?.status === 'completed') {
      throw new ConflictException('La lezione è già stata creata da questo import.');
    }
    const now = new Date().toISOString();
    // Dopo un fallimento si riprende dal passo interrotto, mantenendo scelte e risultati.
    const doc: SlideLessonDoc = existing
      ? { ...existing, status: 'running', error: undefined, updatedAt: now }
      : {
          importId,
          courseId,
          status: 'running',
          step: 'render',
          layout: input.layout ?? 'split',
          moduleTitle: (input.moduleTitle ?? '').trim() || 'Video-lezione',
          createdAt: now,
          updatedAt: now,
        };
    await this.save(tenantId, doc);
    this.launch(tenantId, courseId, importId);
    return this.view(doc);
  }

  async status(tenantId: string, courseId: string, importId: string): Promise<SlideLessonView | null> {
    await this.slides.loadManifest(tenantId, courseId, importId);
    const doc = await this.load(tenantId, courseId, importId);
    if (!doc) return null;
    if (
      doc.status === 'running' &&
      !this.active.has(this.runKey(tenantId, importId)) &&
      (doc.leaseUntil ?? 0) <= Date.now()
    ) {
      this.logger.log(`Ripresa montaggio orfano (import ${importId})`);
      this.launch(tenantId, courseId, importId);
    }
    return this.view(doc);
  }

  private launch(tenantId: string, courseId: string, importId: string): void {
    const key = this.runKey(tenantId, importId);
    if (this.active.has(key)) return;
    this.active.add(key);
    void this.run(tenantId, courseId, importId)
      .catch((err) => this.logger.error(`Montaggio fallito (import ${importId}): ${errMsg(err)}`))
      .finally(() => this.active.delete(key));
  }

  private async run(tenantId: string, courseId: string, importId: string): Promise<void> {
    const doc = await this.load(tenantId, courseId, importId);
    if (!doc || doc.status !== 'running') return;
    const heartbeat = setInterval(() => void this.save(tenantId, doc).catch(() => undefined), HEARTBEAT_MS);
    try {
      if (!doc.videoKey) await this.stepRender(tenantId, doc);
      if (!doc.summaryHtml) await this.stepSummary(tenantId, doc);
      if (!doc.lessonReady) await this.stepLesson(tenantId, doc);
      if (!doc.quizReady) await this.stepQuiz(tenantId, doc);
      doc.step = 'done';
      doc.status = 'completed';
      doc.owner = undefined;
      doc.leaseUntil = undefined;
      await this.save(tenantId, doc, false);
      this.logger.log(`Lezione video da slide creata (import ${importId}, lezione ${doc.lessonId})`);
    } catch (err) {
      doc.status = 'failed';
      doc.error = errMsg(err);
      doc.owner = undefined;
      doc.leaseUntil = undefined;
      await this.save(tenantId, doc, false).catch(() => undefined);
      throw err;
    } finally {
      clearInterval(heartbeat);
    }
  }

  // --- Passo 1: render ------------------------------------------------------

  private async stepRender(tenantId: string, doc: SlideLessonDoc): Promise<void> {
    doc.step = 'render';
    await this.save(tenantId, doc);
    const { courseId, importId } = doc;
    const manifest = await this.slides.loadManifest(tenantId, courseId, importId);
    const clipsView = await this.clips.status(tenantId, courseId, importId);
    if (!clipsView) throw new Error('Clip non trovate');
    const imageByIndex = new Map(manifest.slides.map((s) => [s.index, s.imageKey]));
    const scripts = await this.scripts.get(tenantId, courseId, importId);
    const scriptByIndex = new Map((scripts?.slides ?? []).map((s) => [s.index, s.script]));

    const assembly = [];
    for (const c of [...clipsView.clips].sort((a, b) => a.index - b.index)) {
      const imageKey = imageByIndex.get(c.index);
      if (!imageKey || !c.clipKey || !c.durationSec) throw new Error(`Slide ${c.index}: asset mancanti`);
      let srt: string | undefined;
      if (c.srtKey) srt = (await this.storage.getObject(c.srtKey)).toString('utf8');
      assembly.push({
        id: `slide-${c.index}`,
        imageUrl: await this.storage.getSignedUrl(imageKey, { expiresInSec: MEDIA_URL_TTL_SEC }),
        clipUrl: await this.storage.getSignedUrl(c.clipKey, { expiresInSec: MEDIA_URL_TTL_SEC }),
        durationSec: c.durationSec,
        narration: scriptByIndex.get(c.index),
        srt,
      });
    }
    const spec = buildSlideVideoSpec({ slides: assembly, layout: doc.layout, sectionTitle: doc.moduleTitle });

    const cfg = this.config.get('cartoonVideo', { infer: true });
    const video = await import('@scorm/video');
    let result: { bytes: Uint8Array; durationSec: number };
    if (cfg.renderMode === 'lambda') {
      if (!cfg.lambdaFunctionName || !cfg.lambdaServeUrl) {
        throw new BadRequestException('Render Lambda non configurato (CARTOON_LAMBDA_*)');
      }
      result = await video.renderSlideVideoOnLambda(spec, {
        region: cfg.lambdaRegion,
        functionName: cfg.lambdaFunctionName,
        serveUrl: cfg.lambdaServeUrl,
      });
    } else {
      result = await video.renderSlideVideo(spec);
    }

    const key = `media/${tenantId}/${courseId}/video/${randomUUID()}.mp4`;
    await this.storage.putObject(key, Buffer.from(result.bytes), { contentType: 'video/mp4' });
    await this.meter.record({
      tenantId,
      courseId,
      provider: 'BEDROCK_VIDEO',
      model: 'remotion-slide-video',
      unit: 'SECONDS',
      quantity: Math.max(1, Math.ceil(result.durationSec)),
      source: 'slide_video',
      region: 'global',
    });
    // Trascrizione globale pronta per la lezione (stessa timeline del render).
    const timeline = computeSlideTimeline(spec.slides, spec.canvas.fps);
    doc.videoKey = key;
    doc.videoDurationSec = result.durationSec;
    await this.storage.putObject(
      `${this.prefix(tenantId, doc)}/transcript.json`,
      Buffer.from(JSON.stringify(globalCues(spec.slides, timeline))),
      { contentType: 'application/json' },
    );
    await this.save(tenantId, doc);
  }

  // --- Passo 2: riepilogo e punti chiave ------------------------------------

  private async stepSummary(tenantId: string, doc: SlideLessonDoc): Promise<void> {
    doc.step = 'summary';
    await this.save(tenantId, doc);
    const narration = await this.narrationText(tenantId, doc);
    const language = await this.courseLanguage(tenantId, doc.courseId);
    const result = await this.llm.generate({
      system: systemPrompt(),
      messages: [
        {
          role: 'user',
          content: [
            `Lingua: ${language}.`,
            'Dal testo narrato di una video-lezione scrivi (1) un riepilogo scritto di 120-180 parole e (2) da 4 a 7 punti chiave.',
            'Usa SOLO informazioni presenti nel testo: non aggiungere fatti, norme o consigli nuovi. Tono professionale ma caldo.',
            'Il riepilogo è HTML semplice (<p>, <ul>, <li>, <strong>); i punti chiave sono frasi brevi senza HTML.',
            '',
            'TESTO NARRATO:',
            narration,
          ].join('\n'),
        },
      ],
      schema: SUMMARY_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.3,
      maxTokens: 2500,
    });
    await this.recordLlm(tenantId, doc.courseId, result, 'slide_summary');
    const parsed = JSON.parse(result.text) as { summary?: string; keyPoints?: string[] };
    if (!parsed.summary?.trim() || !Array.isArray(parsed.keyPoints) || parsed.keyPoints.length === 0) {
      throw new Error('Riepilogo non valido');
    }
    doc.summaryHtml = parsed.summary.trim();
    doc.keyPointsHtml = `<ul>${parsed.keyPoints.map((p) => `<li>${escapeHtml(p.trim())}</li>`).join('')}</ul>`;
    await this.save(tenantId, doc);
  }

  // --- Passo 3: modulo + lezione --------------------------------------------

  private async stepLesson(tenantId: string, doc: SlideLessonDoc): Promise<void> {
    doc.step = 'lesson';
    await this.save(tenantId, doc);
    const cues = JSON.parse(
      (await this.storage.getObject(`${this.prefix(tenantId, doc)}/transcript.json`)).toString('utf8'),
    ) as Array<{ id: string; start: number; end: number; text: string }>;

    const mod = doc.moduleId
      ? { id: doc.moduleId }
      : await this.modules.addModule(tenantId, doc.courseId, { title: doc.moduleTitle });
    doc.moduleId = mod.id;
    await this.save(tenantId, doc);

    // Riusa la lezione creata in un tentativo interrotto, invece di duplicarla.
    const lesson = doc.lessonId
      ? { id: doc.lessonId }
      : await this.modules.addLesson(tenantId, doc.courseId, mod.id, { title: doc.moduleTitle });
    doc.lessonId = lesson.id;
    await this.save(tenantId, doc);
    await this.modules.setLessonFormat(tenantId, doc.courseId, mod.id, lesson.id, 'video_first');

    const blocks: Block[] = [
      {
        id: `video-${randomUUID().slice(0, 8)}`,
        type: 'video_checkpoint',
        editorial: { status: 'draft', citations: [] },
        payload: {
          video: { kind: 'video', storageKey: doc.videoKey, alt: doc.moduleTitle, source: 'upload' },
          checkpoints: [],
          transcript: cues.map((c) => ({ id: c.id, start: c.start, end: c.end, text: c.text })),
          transcriptStatus: 'ready',
          sections: [
            {
              id: `sec-${randomUUID().slice(0, 8)}`,
              title: 'Punti chiave',
              content: { format: 'html', html: doc.keyPointsHtml ?? '' },
            },
          ],
        },
      },
      {
        id: `riepilogo-${randomUUID().slice(0, 8)}`,
        type: 'rich_text',
        editorial: { status: 'draft', citations: [] },
        payload: { content: { format: 'html', html: doc.summaryHtml ?? '' }, media: [] },
      },
    ];
    await this.modules.setLessonBlocks(tenantId, doc.courseId, mod.id, lesson.id, blocks);
    doc.lessonReady = true;
    await this.save(tenantId, doc);
  }

  // --- Passo 4: quiz ---------------------------------------------------------

  private async stepQuiz(tenantId: string, doc: SlideLessonDoc): Promise<void> {
    doc.step = 'quiz';
    await this.save(tenantId, doc);
    const narration = await this.narrationText(tenantId, doc);
    const language = await this.courseLanguage(tenantId, doc.courseId);
    const course = await this.prisma.course.findFirst({
      where: { id: doc.courseId, tenantId },
      select: { title: true },
    });

    let assessment: ReturnType<typeof Assessment.parse> | undefined;
    let lastErr: unknown;
    for (let i = 0; i < 3 && !assessment; i++) {
      try {
        const result = await this.llm.generate({
          system: systemPrompt(),
          messages: [
            {
              role: 'user',
              content: assessmentPrompt({
                courseTitle: course?.title ?? doc.moduleTitle,
                scope: 'intermediate',
                focus: doc.moduleTitle,
                language,
                context: [
                  '',
                  'Scrivi da 5 a 8 domande basate ESCLUSIVAMENTE sul testo seguente (la narrazione della video-lezione).',
                  'Non usare conoscenze esterne. Ogni domanda deve avere una sola risposta inequivocabilmente corretta secondo il testo.',
                  '',
                  'TESTO:',
                  narration,
                ].join('\n'),
              }),
            },
          ],
          schema: assessmentJsonSchema as Record<string, unknown>,
          temperature: i === 0 ? 0.4 : 0.2,
          maxTokens: 8000,
        });
        await this.recordLlm(tenantId, doc.courseId, result, 'slide_quiz');
        if (result.finishReason === 'max_tokens') throw new Error('Quiz troncato');
        assessment = Assessment.parse(JSON.parse(result.text));
      } catch (err) {
        lastErr = err;
        this.logger.warn(`Quiz tentativo ${i + 1}/3 fallito: ${errMsg(err)}`);
      }
    }
    if (!assessment) throw lastErr ?? new Error('Generazione quiz non riuscita');

    // Un quiz salvato a metà in un tentativo interrotto si scarta e si ricrea.
    if (doc.assessmentId) {
      await this.modules.deleteAssessment(tenantId, doc.courseId, doc.assessmentId).catch(() => undefined);
      doc.assessmentId = undefined;
    }
    const created = await this.modules.addAssessment(tenantId, doc.courseId, {
      title: `Verifica: ${doc.moduleTitle}`,
      scope: 'INTERMEDIATE',
      moduleId: doc.moduleId,
    });
    doc.assessmentId = created.id;
    await this.save(tenantId, doc);
    for (const q of assessment.questions) {
      await this.modules.addQuestion(tenantId, doc.courseId, created.id, q);
    }
    doc.quizReady = true;
    await this.save(tenantId, doc);
  }

  // --- Utilità ---------------------------------------------------------------

  private prefix(tenantId: string, doc: SlideLessonDoc): string {
    return `media/${tenantId}/${doc.courseId}/slides/${doc.importId}`;
  }

  /** Testo narrato (copioni delle slide incluse), in ordine di slide. */
  private async narrationText(tenantId: string, doc: SlideLessonDoc): Promise<string> {
    const scripts = await this.scripts.get(tenantId, doc.courseId, doc.importId);
    if (!scripts) throw new Error('Copioni non trovati');
    return scripts.slides
      .filter((s) => !s.skip)
      .map((s) => s.script.trim())
      .join('\n\n');
  }

  private async courseLanguage(tenantId: string, courseId: string): Promise<string> {
    const c = await this.prisma.course.findFirst({ where: { id: courseId, tenantId }, select: { language: true } });
    return c?.language ?? 'it';
  }

  private async recordLlm(
    tenantId: string,
    courseId: string,
    result: { model: string; usage: { inputTokens: number; outputTokens: number } },
    source: string,
  ): Promise<void> {
    for (const unit of ['INPUT_TOKENS', 'OUTPUT_TOKENS'] as const) {
      await this.meter.record({
        tenantId,
        courseId,
        provider: 'BEDROCK_LLM',
        model: result.model,
        unit,
        quantity: unit === 'INPUT_TOKENS' ? result.usage.inputTokens : result.usage.outputTokens,
        source,
      });
    }
  }

  private async load(tenantId: string, courseId: string, importId: string): Promise<SlideLessonDoc | null> {
    const key = this.docKey(tenantId, courseId, importId);
    if (!(await this.storage.exists(key))) return null;
    return JSON.parse((await this.storage.getObject(key)).toString('utf8')) as SlideLessonDoc;
  }

  private save(tenantId: string, doc: SlideLessonDoc, lease = true): Promise<void> {
    if (lease) {
      doc.owner = this.instanceId;
      doc.leaseUntil = Date.now() + LEASE_MS;
    }
    doc.updatedAt = new Date().toISOString();
    return this.storage.putObject(
      this.docKey(tenantId, doc.courseId, doc.importId),
      Buffer.from(JSON.stringify(doc)),
      { contentType: 'application/json' },
    );
  }

  private view(doc: SlideLessonDoc): SlideLessonView {
    const { owner: _o, leaseUntil: _l, ...rest } = doc;
    return rest;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'errore sconosciuto';
}
