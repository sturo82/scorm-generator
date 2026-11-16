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
/** Indice oltre ogni slide reale: l'ultima parte include anche le slide "extra" (indici alti). */
const OPEN_END = 1_000_000;

type Step = 'render' | 'summary' | 'lesson' | 'quiz' | 'final_quiz' | 'done';

/**
 * Una "parte" è una lezione video con il suo modulo: nel caso "una sola lezione" ce n'è
 * una che copre tutte le slide; con le sezioni ce n'è una per sezione.
 */
export interface LessonPart {
  id: string;
  title: string;
  /** Intervallo di slide (indici inclusi). L'ultima parte arriva a OPEN_END. */
  from: number;
  to: number;
  /** Avanzamento persistito: ogni passo completato non si ripete dopo un riavvio. */
  videoKey?: string;
  videoDurationSec?: number;
  transcriptKey?: string;
  summaryHtml?: string;
  keyPointsHtml?: string;
  moduleId?: string;
  lessonId?: string;
  /** True quando i blocchi della lezione sono stati scritti (lessonId può esistere prima). */
  lessonReady?: boolean;
  assessmentId?: string;
  /** True quando tutte le domande del quiz sono state salvate. */
  quizReady?: boolean;
}

export interface SlideLessonDoc {
  importId: string;
  courseId: string;
  status: 'running' | 'completed' | 'failed';
  step: Step;
  error?: string;
  layout: SlideVideoLayout;
  /** Titolo del corso/modulo (modalità "una lezione") o del gruppo di sezioni. */
  moduleTitle: string;
  mode: 'single' | 'sections';
  parts: LessonPart[];
  /** Indice (0-based) della parte in lavorazione. */
  currentPart: number;
  finalAssessmentId?: string;
  finalQuizReady?: boolean;
  createdAt: string;
  updatedAt: string;
  owner?: string;
  leaseUntil?: number;
}

export interface SlideLessonView {
  importId: string;
  courseId: string;
  status: SlideLessonDoc['status'];
  step: Step;
  error?: string;
  layout: SlideVideoLayout;
  moduleTitle: string;
  mode: SlideLessonDoc['mode'];
  currentPart: number;
  parts: Array<{ id: string; title: string; done: boolean; moduleId?: string; lessonId?: string }>;
  /** Primo modulo/lezione creati (compatibilità con la modalità "una lezione"). */
  moduleId?: string;
  lessonId?: string;
}

export interface SectionInput {
  title: string;
  /** Prima slide della sezione (1-based). */
  from: number;
}

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Riepilogo scritto in HTML semplice (<p>, <ul>, <li>, <strong>).' },
    keyPoints: { type: 'array', items: { type: 'string' }, description: 'Da 4 a 7 punti chiave, una frase ciascuno.' },
  },
  required: ['summary', 'keyPoints'],
  additionalProperties: false,
} as const;

const SECTIONS_SCHEMA = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, startIndex: { type: 'integer' } },
        required: ['title', 'startIndex'],
      },
    },
  },
  required: ['sections'],
  additionalProperties: false,
} as const;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Fase finale della pipeline "slide + avatar": monta il video (Remotion), scrive
 * riepilogo e quiz a partire dai copioni approvati e crea modulo + lezione
 * video-first con trascrizione. Può creare UNA lezione con tutte le slide oppure UN
 * MODULO PER SEZIONE (un video, un riepilogo e un quiz per sezione, più un quiz
 * finale). Lo stato (con i passi già completati) vive in `lesson.json` accanto
 * all'import: dopo un riavvio si riprende dal passo successivo senza rifare render
 * o chiamate LLM già fatte.
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
  private prefix(tenantId: string, doc: { courseId: string; importId: string }): string {
    return `media/${tenantId}/${doc.courseId}/slides/${doc.importId}`;
  }

  // --- Sezioni ---------------------------------------------------------------

  /** Propone la divisione in sezioni (titoli e slide di inizio) leggendo il testo delle slide. */
  async proposeSections(tenantId: string, courseId: string, importId: string): Promise<SectionInput[]> {
    const manifest = await this.slides.loadManifest(tenantId, courseId, importId);
    const language = await this.courseLanguage(tenantId, courseId);
    const deck = manifest.slides
      .map((s) => `Slide ${s.index}: ${s.text.replace(/\s+/g, ' ').trim().slice(0, 160) || '(solo grafica)'}`)
      .join('\n');
    const result = await this.llm.generate({
      system: systemPrompt(),
      messages: [
        {
          role: 'user',
          content: [
            `Lingua dei titoli: ${language}.`,
            'Dividi questa presentazione in SEZIONI tematiche coerenti, ciascuna destinata a diventare un modulo di corso con un video.',
            'Se ci sono slide divisorie o titoli di capitolo ("Introduction 1", "Abuse 2"…), usale come confini. Di norma 2-8 sezioni, ciascuna con almeno 3 slide quando possibile.',
            'Per ogni sezione dai un titolo breve e l\'indice della sua PRIMA slide. La prima sezione parte dalla slide 1; gli indici sono crescenti.',
            '',
            deck,
          ].join('\n'),
        },
      ],
      schema: SECTIONS_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.2,
      maxTokens: 1500,
    });
    await this.recordLlm(tenantId, courseId, result, 'slide_sections');
    const parsed = JSON.parse(result.text) as { sections?: Array<{ title?: string; startIndex?: number }> };
    const max = manifest.slides.length;
    const out: SectionInput[] = [];
    for (const s of parsed.sections ?? []) {
      const from = Number(s.startIndex);
      const title = (s.title ?? '').trim();
      if (!title || !Number.isInteger(from) || from < 1 || from > max) continue;
      if (out.length > 0 && from <= out[out.length - 1]!.from) continue;
      out.push({ title, from });
    }
    if (out.length === 0) return [{ title: 'Sezione 1', from: 1 }];
    out[0]!.from = 1;
    return out;
  }

  // --- Avvio e stato -----------------------------------------------------------

  async start(
    tenantId: string,
    courseId: string,
    importId: string,
    input: { layout?: SlideVideoLayout; moduleTitle?: string; sections?: SectionInput[] },
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
    let doc: SlideLessonDoc;
    if (existing) {
      // Dopo un fallimento si riprende dal passo interrotto, mantenendo scelte e risultati.
      doc = { ...existing, status: 'running', error: undefined, updatedAt: now };
    } else {
      const moduleTitle = (input.moduleTitle ?? '').trim() || 'Video-lezione';
      const sections = input.sections && input.sections.length > 0 ? input.sections : null;
      const parts = sections
        ? this.partsFromSections(sections, clipsView.clips.map((c) => c.index))
        : [{ id: randomUUID().slice(0, 8), title: moduleTitle, from: 1, to: OPEN_END }];
      doc = {
        importId,
        courseId,
        status: 'running',
        step: 'render',
        layout: input.layout ?? 'split',
        moduleTitle,
        mode: sections ? 'sections' : 'single',
        parts,
        currentPart: 0,
        createdAt: now,
        updatedAt: now,
      };
    }
    await this.save(tenantId, doc);
    this.launch(tenantId, courseId, importId);
    return this.view(doc);
  }

  /** Valida le sezioni e ne calcola gli intervalli; ogni sezione deve avere almeno una clip. */
  private partsFromSections(sections: SectionInput[], clipIndexes: number[]): LessonPart[] {
    const sorted = [...sections].sort((a, b) => a.from - b.from);
    if (sorted[0]!.from !== 1) throw new BadRequestException('La prima sezione deve iniziare dalla slide 1');
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.from <= sorted[i - 1]!.from) throw new BadRequestException('Le sezioni devono avere slide di inizio diverse');
    }
    return sorted.map((s, i) => {
      const to = i < sorted.length - 1 ? sorted[i + 1]!.from - 1 : OPEN_END;
      if (!clipIndexes.some((n) => n >= s.from && n <= to)) {
        throw new BadRequestException(`La sezione «${s.title}» non contiene slide incluse nel video`);
      }
      return { id: randomUUID().slice(0, 8), title: s.title.trim() || `Sezione ${i + 1}`, from: s.from, to };
    });
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
      for (let i = 0; i < doc.parts.length; i++) {
        doc.currentPart = i;
        const part = doc.parts[i]!;
        const isLast = i === doc.parts.length - 1;
        if (!part.videoKey) await this.stepRender(tenantId, doc, part);
        if (!part.summaryHtml) await this.stepSummary(tenantId, doc, part);
        if (!part.lessonReady) await this.stepLesson(tenantId, doc, part, isLast);
        if (!part.quizReady) await this.stepQuiz(tenantId, doc, part);
      }
      if (doc.mode === 'sections' && doc.parts.length > 1 && !doc.finalQuizReady) {
        await this.stepFinalQuiz(tenantId, doc);
      }
      doc.step = 'done';
      doc.status = 'completed';
      doc.owner = undefined;
      doc.leaseUntil = undefined;
      await this.save(tenantId, doc, false);
      this.logger.log(`Video-lezione da slide creata (import ${importId}, ${doc.parts.length} parti)`);
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

  private async stepRender(tenantId: string, doc: SlideLessonDoc, part: LessonPart): Promise<void> {
    doc.step = 'render';
    await this.save(tenantId, doc);
    const { courseId, importId } = doc;
    const manifest = await this.slides.loadManifest(tenantId, courseId, importId);
    const clipsView = await this.clips.status(tenantId, courseId, importId);
    if (!clipsView) throw new Error('Clip non trovate');
    const imageByIndex = new Map(manifest.slides.map((s) => [s.index, s.imageKey]));
    const scripts = await this.scripts.get(tenantId, courseId, importId);
    const scriptByIndex = new Map((scripts?.slides ?? []).map((s) => [s.index, s.script]));
    const scriptEntry = new Map((scripts?.slides ?? []).map((s) => [s.index, s]));

    const partClips = clipsView.clips
      .filter((c) => c.index >= part.from && c.index <= part.to)
      .sort((a, b) => a.index - b.index);
    if (partClips.length === 0) throw new Error(`Nessuna clip per «${part.title}»`);

    const assembly = [];
    for (const c of partClips) {
      const imageKey = imageByIndex.get(c.index);
      const extra = scriptEntry.get(c.index)?.extra;
      if ((!imageKey && !extra) || !c.clipKey || !c.durationSec) throw new Error(`Slide ${c.index}: asset mancanti`);
      let srt: string | undefined;
      if (c.srtKey) srt = (await this.storage.getObject(c.srtKey)).toString('utf8');
      assembly.push({
        id: `slide-${c.index}`,
        // Le slide "extra" (argomenti della knowledge narrati) non hanno immagine: le disegna il renderer.
        imageUrl: imageKey ? await this.storage.getSignedUrl(imageKey, { expiresInSec: MEDIA_URL_TTL_SEC }) : undefined,
        textSlide: !imageKey && extra ? { title: extra.title, bullets: extra.bullets } : undefined,
        clipUrl: await this.storage.getSignedUrl(c.clipKey, { expiresInSec: MEDIA_URL_TTL_SEC }),
        durationSec: c.durationSec,
        narration: scriptByIndex.get(c.index),
        srt,
      });
    }
    const spec = buildSlideVideoSpec({ slides: assembly, layout: doc.layout, sectionTitle: part.title });

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
    part.transcriptKey = `${this.prefix(tenantId, doc)}/transcript-${part.id}.json`;
    await this.storage.putObject(
      part.transcriptKey,
      Buffer.from(JSON.stringify(globalCues(spec.slides, timeline))),
      { contentType: 'application/json' },
    );
    part.videoKey = key;
    part.videoDurationSec = result.durationSec;
    await this.save(tenantId, doc);
  }

  // --- Passo 2: riepilogo e punti chiave ------------------------------------

  private async stepSummary(tenantId: string, doc: SlideLessonDoc, part: LessonPart): Promise<void> {
    doc.step = 'summary';
    await this.save(tenantId, doc);
    const narration = await this.narrationText(tenantId, doc, part);
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
    part.summaryHtml = parsed.summary.trim();
    part.keyPointsHtml = `<ul>${parsed.keyPoints.map((p) => `<li>${escapeHtml(p.trim())}</li>`).join('')}</ul>`;
    await this.save(tenantId, doc);
  }

  // --- Passo 3: modulo + lezione --------------------------------------------

  private async stepLesson(tenantId: string, doc: SlideLessonDoc, part: LessonPart, isLast: boolean): Promise<void> {
    doc.step = 'lesson';
    await this.save(tenantId, doc);
    const cues = JSON.parse((await this.storage.getObject(part.transcriptKey!)).toString('utf8')) as Array<{
      id: string;
      start: number;
      end: number;
      text: string;
    }>;

    const mod = part.moduleId
      ? { id: part.moduleId }
      : await this.modules.addModule(tenantId, doc.courseId, { title: part.title });
    part.moduleId = mod.id;
    await this.save(tenantId, doc);

    // Riusa la lezione creata in un tentativo interrotto, invece di duplicarla.
    const lesson = part.lessonId
      ? { id: part.lessonId }
      : await this.modules.addLesson(tenantId, doc.courseId, mod.id, { title: part.title });
    part.lessonId = lesson.id;
    await this.save(tenantId, doc);
    await this.modules.setLessonFormat(tenantId, doc.courseId, mod.id, lesson.id, 'video_first');

    const sections: Array<{ id: string; title: string; content: { format: 'html'; html: string } }> = [
      {
        id: `sec-${randomUUID().slice(0, 8)}`,
        title: 'Punti chiave',
        content: { format: 'html', html: part.keyPointsHtml ?? '' },
      },
    ];
    // Argomenti della knowledge non coperti dalle slide e non narrati: parte scritta dell'ultima lezione.
    if (isLast) {
      const scripts = await this.scripts.get(tenantId, doc.courseId, doc.importId);
      const writtenTopics = (scripts?.slides ?? []).filter((s) => s.extra && s.skip);
      if (writtenTopics.length > 0) {
        const html = writtenTopics
          .map((t) => {
            const e = t.extra!;
            const bullets = e.bullets.length ? `<ul>${e.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : '';
            return `<h4>${escapeHtml(e.title)}</h4><p>${escapeHtml(e.summary)}</p>${bullets}`;
          })
          .join('');
        sections.push({ id: `sec-${randomUUID().slice(0, 8)}`, title: 'Approfondimenti', content: { format: 'html', html } });
      }
    }

    const blocks: Block[] = [
      {
        id: `video-${randomUUID().slice(0, 8)}`,
        type: 'video_checkpoint',
        editorial: { status: 'draft', citations: [] },
        payload: {
          video: { kind: 'video', storageKey: part.videoKey, alt: part.title, source: 'upload' },
          checkpoints: [],
          transcript: cues.map((c) => ({ id: c.id, start: c.start, end: c.end, text: c.text })),
          transcriptStatus: 'ready',
          sections,
        },
      },
      {
        id: `riepilogo-${randomUUID().slice(0, 8)}`,
        type: 'rich_text',
        editorial: { status: 'draft', citations: [] },
        payload: { content: { format: 'html', html: part.summaryHtml ?? '' }, media: [] },
      },
    ];
    await this.modules.setLessonBlocks(tenantId, doc.courseId, mod.id, lesson.id, blocks);
    part.lessonReady = true;
    await this.save(tenantId, doc);
  }

  // --- Passo 4: quiz di modulo ------------------------------------------------

  private async stepQuiz(tenantId: string, doc: SlideLessonDoc, part: LessonPart): Promise<void> {
    doc.step = 'quiz';
    await this.save(tenantId, doc);
    const narration = await this.narrationText(tenantId, doc, part);
    // Un quiz salvato a metà in un tentativo interrotto si scarta e si ricrea.
    if (part.assessmentId) {
      await this.modules.deleteAssessment(tenantId, doc.courseId, part.assessmentId).catch(() => undefined);
      part.assessmentId = undefined;
    }
    const assessment = await this.generateAssessment(tenantId, doc, part.title, narration, 'intermediate');
    const created = await this.modules.addAssessment(tenantId, doc.courseId, {
      title: `Verifica: ${part.title}`,
      scope: 'INTERMEDIATE',
      moduleId: part.moduleId,
    });
    part.assessmentId = created.id;
    await this.save(tenantId, doc);
    for (const q of assessment.questions) {
      await this.modules.addQuestion(tenantId, doc.courseId, created.id, q);
    }
    part.quizReady = true;
    await this.save(tenantId, doc);
  }

  // --- Passo 5: quiz finale (solo con più sezioni) ---------------------------

  private async stepFinalQuiz(tenantId: string, doc: SlideLessonDoc): Promise<void> {
    doc.step = 'final_quiz';
    await this.save(tenantId, doc);
    const narration = await this.narrationText(tenantId, doc);
    if (doc.finalAssessmentId) {
      await this.modules.deleteAssessment(tenantId, doc.courseId, doc.finalAssessmentId).catch(() => undefined);
      doc.finalAssessmentId = undefined;
    }
    const assessment = await this.generateAssessment(tenantId, doc, doc.moduleTitle, narration, 'final');
    const created = await this.modules.addAssessment(tenantId, doc.courseId, {
      title: `Test finale: ${doc.moduleTitle}`,
      scope: 'FINAL',
    });
    doc.finalAssessmentId = created.id;
    await this.save(tenantId, doc);
    for (const q of assessment.questions) {
      await this.modules.addQuestion(tenantId, doc.courseId, created.id, q);
    }
    doc.finalQuizReady = true;
    await this.save(tenantId, doc);
  }

  private async generateAssessment(
    tenantId: string,
    doc: SlideLessonDoc,
    focus: string,
    narration: string,
    scope: 'intermediate' | 'final',
  ): Promise<ReturnType<typeof Assessment.parse>> {
    const language = await this.courseLanguage(tenantId, doc.courseId);
    const course = await this.prisma.course.findFirst({
      where: { id: doc.courseId, tenantId },
      select: { title: true },
    });
    const count = scope === 'final' ? 'da 8 a 12' : 'da 5 a 8';
    let lastErr: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        const result = await this.llm.generate({
          system: systemPrompt(),
          messages: [
            {
              role: 'user',
              content: assessmentPrompt({
                courseTitle: course?.title ?? doc.moduleTitle,
                scope,
                focus,
                language,
                context: [
                  '',
                  `Scrivi ${count} domande basate ESCLUSIVAMENTE sul testo seguente (la narrazione della video-lezione).`,
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
          maxTokens: scope === 'final' ? 12000 : 8000,
        });
        await this.recordLlm(tenantId, doc.courseId, result, 'slide_quiz');
        if (result.finishReason === 'max_tokens') throw new Error('Quiz troncato');
        return Assessment.parse(JSON.parse(result.text));
      } catch (err) {
        lastErr = err;
        this.logger.warn(`Quiz tentativo ${i + 1}/3 fallito: ${errMsg(err)}`);
      }
    }
    throw lastErr ?? new Error('Generazione quiz non riuscita');
  }

  // --- Utilità ---------------------------------------------------------------

  /** Testo narrato (copioni delle slide incluse), in ordine; con `part` solo il suo intervallo. */
  private async narrationText(tenantId: string, doc: SlideLessonDoc, part?: LessonPart): Promise<string> {
    const scripts = await this.scripts.get(tenantId, doc.courseId, doc.importId);
    if (!scripts) throw new Error('Copioni non trovati');
    return scripts.slides
      .filter((s) => !s.skip && (!part || (s.index >= part.from && s.index <= part.to)))
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

  /** Legge lo stato, migrando i documenti salvati prima delle "parti" (campi piatti → una parte). */
  private async load(tenantId: string, courseId: string, importId: string): Promise<SlideLessonDoc | null> {
    const key = this.docKey(tenantId, courseId, importId);
    if (!(await this.storage.exists(key))) return null;
    const raw = JSON.parse((await this.storage.getObject(key)).toString('utf8')) as SlideLessonDoc & Partial<LessonPart>;
    if (!raw.parts) {
      raw.parts = [
        {
          id: 'main',
          title: raw.moduleTitle,
          from: 1,
          to: OPEN_END,
          videoKey: raw.videoKey,
          videoDurationSec: raw.videoDurationSec,
          transcriptKey: raw.videoKey ? `${this.prefix(tenantId, raw)}/transcript.json` : undefined,
          summaryHtml: raw.summaryHtml,
          keyPointsHtml: raw.keyPointsHtml,
          moduleId: raw.moduleId,
          lessonId: raw.lessonId,
          lessonReady: raw.lessonReady,
          assessmentId: raw.assessmentId,
          quizReady: raw.quizReady,
        },
      ];
      raw.mode = 'single';
      raw.currentPart = 0;
    }
    return raw;
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
    return {
      importId: doc.importId,
      courseId: doc.courseId,
      status: doc.status,
      step: doc.step,
      error: doc.error,
      layout: doc.layout,
      moduleTitle: doc.moduleTitle,
      mode: doc.mode,
      currentPart: doc.currentPart,
      parts: doc.parts.map((p) => ({
        id: p.id,
        title: p.title,
        done: p.quizReady === true,
        moduleId: p.moduleId,
        lessonId: p.lessonId,
      })),
      moduleId: doc.parts[0]?.moduleId,
      lessonId: doc.parts[0]?.lessonId,
    };
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'errore sconosciuto';
}
