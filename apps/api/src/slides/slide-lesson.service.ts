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
  BRAND_STORAGE_PREFIX,
  computeSlideTimeline,
  globalCues,
  slideVideoSegments,
  type Block,
  type SlideCardInput,
  type SlideVideoCard,
  type PipPosition,
  type AvatarFrame,
  type SlideShot,
  type SlideVideoLayout,
  type SlideVideoTheme,
} from '@scorm/contracts';
import type { LLMProvider, ObjectStorage } from '@scorm/domain';
import type { AppConfig } from '../config/configuration.js';
import { ModulesService } from '../courses/modules.service.js';
import { assessmentPrompt, systemPrompt } from '../generation/prompts.js';
import { UsageMeterService } from '../metering/usage-meter.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LLM_PROVIDER, OBJECT_STORAGE } from '../providers/provider.constants.js';
import { buildSlideVideoSpec, type AssemblySlide } from './slide-assembly.js';
import { autoDirection, type SlideDirection } from './slide-direction.js';
import { createHash } from 'node:crypto';
import { SlideClipsService } from './slide-clips.service.js';
import { SlideScriptsService } from './slide-scripts.service.js';
import { isLibrary, meterCourseId } from './slide-owner.js';
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
  /** Libreria: id del VideoAsset creato per questa parte. */
  videoAssetId?: string;
  /** Durante un rimontaggio: true quando il video di questa parte è stato rifatto e sostituito. */
  remasterDone?: boolean;
}

export interface SlideLessonDoc {
  importId: string;
  courseId: string;
  status: 'running' | 'completed' | 'failed';
  step: Step;
  error?: string;
  layout: SlideVideoLayout;
  /** Posizione di default del cerchio avatar (layout pip) e override per slide (indice → posizione). */
  pipPosition?: PipPosition;
  slidePositions?: Record<string, PipPosition>;
  /** Inquadrature scelte dall'utente per slide (layout dynamic); le altre seguono la regia automatica. */
  slideShots?: Record<string, SlideShot>;
  /** Inquadratura della persona nella clip avatar (punto al centro e zoom). */
  avatarFrame?: Partial<AvatarFrame>;
  /** Sottotitoli incisi nel video. Assente nei documenti precedenti, che li avevano: vale true. */
  burnCaptions?: boolean;
  /** Copertina e schermata finale (assenti = nessuna). */
  cover?: SlideCardInput;
  outro?: SlideCardInput;
  /** Brand scelto per colori e logo; senza, nei corsi vale il brand principale del corso. */
  brandId?: string;
  /** Titolo del corso/modulo (modalità "una lezione") o del gruppo di sezioni. */
  moduleTitle: string;
  mode: 'single' | 'sections';
  parts: LessonPart[];
  /** Indice (0-based) della parte in lavorazione. */
  currentPart: number;
  finalAssessmentId?: string;
  finalQuizReady?: boolean;
  /** True durante il rimontaggio dei video con le slide aggiornate (le clip avatar non si rigenerano). */
  remaster?: boolean;
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
  pipPosition: PipPosition;
  slidePositions: Record<string, PipPosition>;
  slideShots: Record<string, SlideShot>;
  avatarFrame: Partial<AvatarFrame>;
  burnCaptions: boolean;
  cover?: SlideCardInput;
  outro?: SlideCardInput;
  brandId?: string;
  moduleTitle: string;
  mode: SlideLessonDoc['mode'];
  remaster: boolean;
  currentPart: number;
  parts: Array<{ id: string; title: string; done: boolean; moduleId?: string; lessonId?: string; videoAssetId?: string }>;
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
    const language = await this.courseLanguage(tenantId, courseId, importId);
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
    input: {
      layout?: SlideVideoLayout;
      moduleTitle?: string;
      sections?: SectionInput[];
      pipPosition?: PipPosition;
      slidePositions?: Record<string, PipPosition>;
      slideShots?: Record<string, SlideShot>;
      burnCaptions?: boolean;
      avatarFrame?: Partial<AvatarFrame>;
      cover?: SlideCardInput;
      outro?: SlideCardInput;
      brandId?: string;
    },
  ): Promise<SlideLessonView> {
    await this.validateCards(tenantId, courseId, importId, input.cover, input.outro, input.brandId);
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
        pipPosition: input.pipPosition ?? 'bottom-right',
        slidePositions: input.slidePositions ?? {},
        slideShots: input.slideShots ?? {},
        avatarFrame: input.avatarFrame ?? {},
        burnCaptions: input.burnCaptions ?? false,
        cover: input.cover,
        outro: input.outro,
        brandId: input.brandId,
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

  /**
   * Rifà i video delle lezioni già create con le immagini delle slide ATTUALI (dopo
   * `replacePdf`), riusando le clip avatar: nessun costo HeyGen, solo il montaggio. Sostituisce
   * il video nel blocco esistente di ogni lezione senza toccare trascrizione, riepilogo e quiz.
   */
  async remaster(
    tenantId: string,
    courseId: string,
    importId: string,
    input: {
      layout?: SlideVideoLayout;
      pipPosition?: PipPosition;
      slidePositions?: Record<string, PipPosition>;
      slideShots?: Record<string, SlideShot>;
      burnCaptions?: boolean;
      avatarFrame?: Partial<AvatarFrame>;
      /** `null` toglie la scheda; `undefined` lascia quella attuale. */
      cover?: SlideCardInput | null;
      outro?: SlideCardInput | null;
      brandId?: string | null;
    } = {},
  ): Promise<SlideLessonView> {
    await this.validateCards(tenantId, courseId, importId, input.cover ?? undefined, input.outro ?? undefined, input.brandId ?? undefined);
    const existing = await this.load(tenantId, courseId, importId);
    if (!existing || existing.status !== 'completed') {
      throw new ConflictException('Non c\'è una lezione completata da aggiornare.');
    }
    const clipsNow = await this.clips.status(tenantId, courseId, importId);
    if (!clipsNow || clipsNow.status !== 'completed') {
      throw new ConflictException('Le clip avatar non sono tutte pronte: attendi la fine della generazione.');
    }
    const doc: SlideLessonDoc = {
      ...existing,
      status: 'running',
      step: 'render',
      error: undefined,
      remaster: true,
      layout: input.layout ?? existing.layout,
      pipPosition: input.pipPosition ?? existing.pipPosition ?? 'bottom-right',
      slidePositions: input.slidePositions ?? existing.slidePositions ?? {},
      slideShots: input.slideShots ?? existing.slideShots ?? {},
      avatarFrame: input.avatarFrame ?? existing.avatarFrame ?? {},
      burnCaptions: input.burnCaptions ?? existing.burnCaptions ?? true,
      cover: input.cover === undefined ? existing.cover : (input.cover ?? undefined),
      outro: input.outro === undefined ? existing.outro : (input.outro ?? undefined),
      brandId: input.brandId === undefined ? existing.brandId : (input.brandId ?? undefined),
      currentPart: 0,
      parts: existing.parts.map((p) => ({ ...p, remasterDone: false })),
      updatedAt: new Date().toISOString(),
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
      if (doc.remaster) {
        for (let i = 0; i < doc.parts.length; i++) {
          const part = doc.parts[i]!;
          if (part.remasterDone) continue;
          doc.currentPart = i;
          part.videoKey = undefined;
          await this.stepRender(tenantId, doc, part);
          if (isLibrary(doc.courseId)) await this.updateLibraryVideo(tenantId, part);
          else await this.swapVideo(tenantId, doc, part);
          part.remasterDone = true;
          await this.save(tenantId, doc);
        }
        doc.remaster = false;
        doc.step = 'done';
        doc.status = 'completed';
        doc.owner = undefined;
        doc.leaseUntil = undefined;
        await this.save(tenantId, doc, false);
        this.logger.log(`Video rimontati con le slide aggiornate (import ${importId}, ${doc.parts.length} parti)`);
        return;
      }
      if (isLibrary(courseId)) {
        // Libreria: nessun corso, quindi niente riepilogo, lezioni e quiz. Ogni parte diventa un
        // video riutilizzabile con la sua trascrizione; riepilogo e quiz si creano nel corso.
        for (let i = 0; i < doc.parts.length; i++) {
          doc.currentPart = i;
          const part = doc.parts[i]!;
          if (!part.videoKey) await this.stepRender(tenantId, doc, part);
          if (!part.videoAssetId) await this.createLibraryVideo(tenantId, doc, part);
        }
        doc.step = 'done';
        doc.status = 'completed';
        doc.owner = undefined;
        doc.leaseUntil = undefined;
        await this.save(tenantId, doc, false);
        this.logger.log(`Video da slide salvati in libreria (import ${importId}, ${doc.parts.length} video)`);
        return;
      }
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

    const assembly: AssemblySlide[] = [];
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
        pipPosition: doc.slidePositions?.[String(c.index)],
      });
    }
    // Layout dinamico: regia automatica (inquadratura + angolo libero) con le scelte dell'utente.
    if (doc.layout === 'dynamic') {
      const direction = await this.direction(tenantId, courseId, importId);
      const auto = new Map(direction.map((d) => [d.index, d]));
      for (const a of assembly) {
        const idx = Number(a.id.replace('slide-', ''));
        const d = auto.get(idx);
        a.shot = doc.slideShots?.[String(idx)] ?? d?.shot ?? 'focus';
        a.pipPosition = doc.slidePositions?.[String(idx)] ?? d?.corner ?? 'bottom-right';
      }
    }
    const style = await this.brandStyle(tenantId, doc);
    const spec = buildSlideVideoSpec({
      slides: assembly,
      layout: doc.layout,
      pipPosition: doc.pipPosition,
      burnCaptions: doc.burnCaptions ?? true,
      avatarFrame: doc.avatarFrame,
      sectionTitle: part.title,
      theme: style.theme,
      cover: await this.resolveCard(tenantId, doc, doc.cover, 'cover', part.title, style.logoUrl, manifest.slides, clipsView.clips),
      outro: await this.resolveCard(tenantId, doc, doc.outro, 'outro', part.title, style.logoUrl, manifest.slides, clipsView.clips),
    });

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
      courseId: meterCourseId(courseId),
      provider: 'BEDROCK_VIDEO',
      model: 'remotion-slide-video',
      unit: 'SECONDS',
      quantity: Math.max(1, Math.ceil(result.durationSec)),
      source: 'slide_video',
      region: 'global',
    });
    // Trascrizione globale pronta per la lezione (stessa timeline del render).
    const timeline = computeSlideTimeline(spec.slides, spec.canvas.fps);
    // Con una copertina le slide iniziano dopo di lei: la trascrizione segue lo stesso ritardo.
    const offsetSec = slideVideoSegments(spec, spec.canvas.fps).offsetSec;
    const cues = globalCues(spec.slides, timeline).map((c) => ({ ...c, start: c.start + offsetSec, end: c.end + offsetSec }));
    part.transcriptKey = `${this.prefix(tenantId, doc)}/transcript-${part.id}.json`;
    await this.storage.putObject(
      part.transcriptKey,
      Buffer.from(JSON.stringify(cues)),
      { contentType: 'application/json' },
    );
    part.videoKey = key;
    part.videoDurationSec = result.durationSec;
    await this.save(tenantId, doc);
  }

  /**
   * Regia automatica delle slide incluse nel video (inquadratura + angolo libero), con cache su
   * storage invalidata quando cambiano le slide (es. dopo «Sostituisci con PDF aggiornato»).
   */
  async direction(tenantId: string, courseId: string, importId: string): Promise<SlideDirection[]> {
    const manifest = await this.slides.loadManifest(tenantId, courseId, importId);
    const clipsView = await this.clips.status(tenantId, courseId, importId);
    const scripts = await this.scripts.get(tenantId, courseId, importId);
    const included = (clipsView?.clips ?? []).map((c) => c.index).sort((a, b) => a - b);
    const sig = createHash('sha1')
      .update(JSON.stringify([manifest.filename, manifest.slides.map((x) => x.text), included, 'v1']))
      .digest('hex');
    const cacheKey = `${this.prefix(tenantId, { courseId, importId })}/direction.json`;
    if (await this.storage.exists(cacheKey)) {
      const cached = JSON.parse((await this.storage.getObject(cacheKey)).toString('utf8')) as { sig: string; items: SlideDirection[] };
      if (cached.sig === sig) return cached.items;
    }
    const byIndex = new Map(manifest.slides.map((x) => [x.index, x]));
    const extra = new Map((scripts?.slides ?? []).filter((x) => x.extra).map((x) => [x.index, x.extra!]));
    // Le parti (sezioni) iniziano e finiscono con il presentatore: la regia si calcola per parte.
    const doc = await this.load(tenantId, courseId, importId);
    const parts = doc?.parts?.length ? doc.parts : [{ from: 1, to: OPEN_END }];
    const items: SlideDirection[] = [];
    for (const part of parts) {
      const inputs = [];
      for (const idx of included.filter((n) => n >= part.from && n <= part.to)) {
        const m = byIndex.get(idx);
        const e = extra.get(idx);
        inputs.push({
          index: idx,
          text: m?.text ?? (e ? [e.title, ...e.bullets].join('\n') : ''),
          png: m ? await this.storage.getObject(m.imageKey) : undefined,
          extra: !m && Boolean(e),
        });
      }
      items.push(...autoDirection(inputs));
    }
    await this.storage.putObject(cacheKey, Buffer.from(JSON.stringify({ sig, items })), { contentType: 'application/json' });
    return items;
  }

  /**
   * Colori e logo del video: brand scelto dall'utente oppure, per un corso, il suo brand
   * principale (sfondo scuro, accento del brand). Senza brand restano i colori di default.
   */
  private async brandStyle(tenantId: string, doc: SlideLessonDoc): Promise<{ theme: Partial<SlideVideoTheme>; logoUrl?: string }> {
    let brandId = doc.brandId;
    if (!brandId && !isLibrary(doc.courseId)) {
      const course = await this.prisma.course.findFirst({ where: { id: doc.courseId, tenantId }, select: { primaryBrandId: true } });
      brandId = course?.primaryBrandId ?? undefined;
    }
    if (!brandId) return { theme: {} };
    const brand = await this.prisma.brand.findFirst({ where: { id: brandId, tenantId }, select: { definition: true } });
    const def = brand?.definition as {
      colors?: { primary?: string; secondary?: string };
      assets?: { logoPrimaryUrl?: string; logoInverseUrl?: string };
    } | null;
    const accent = [def?.colors?.primary, def?.colors?.secondary].find((c) => c && luminance(c) > 0.18);
    // Sfondo scuro: meglio il logo per fondi scuri, se il brand lo prevede.
    const logo = def?.assets?.logoInverseUrl || def?.assets?.logoPrimaryUrl || '';
    let logoUrl: string | undefined;
    if (logo.startsWith(BRAND_STORAGE_PREFIX)) {
      logoUrl = await this.storage
        .getSignedUrl(logo.slice(BRAND_STORAGE_PREFIX.length), { expiresInSec: MEDIA_URL_TTL_SEC })
        .catch(() => undefined);
    } else if (/^https:\/\//.test(logo)) {
      logoUrl = logo;
    }
    return { theme: accent ? { accent } : {}, logoUrl };
  }

  /** Controlla che brand e slide indicati per copertina e finale esistano, prima di avviare il montaggio. */
  private async validateCards(
    tenantId: string,
    courseId: string,
    importId: string,
    cover: SlideCardInput | undefined,
    outro: SlideCardInput | undefined,
    brandId: string | undefined,
  ): Promise<void> {
    if (brandId) {
      const brand = await this.prisma.brand.findFirst({ where: { id: brandId, tenantId }, select: { id: true } });
      if (!brand) throw new BadRequestException('Brand non trovato');
    }
    const bgs = [cover?.background, outro?.background].filter((b): b is NonNullable<typeof b> => Boolean(b));
    if (bgs.length === 0) return;
    const manifest = await this.slides.loadManifest(tenantId, courseId, importId);
    const clipsView = await this.clips.status(tenantId, courseId, importId);
    for (const b of bgs) {
      if (b.kind === 'slide' && !manifest.slides.some((s) => s.index === b.index)) {
        throw new BadRequestException(`Slide ${b.index} inesistente per lo sfondo`);
      }
      if (b.kind === 'frame' && !clipsView?.clips.some((c) => c.index === b.index && c.clipKey)) {
        throw new BadRequestException(`La slide ${b.index} non ha una clip avatar da cui prendere il fotogramma`);
      }
    }
  }

  /** Trasforma la scelta dell'utente in scheda del video, con URL firmati per sfondo e logo. */
  private async resolveCard(
    tenantId: string,
    doc: SlideLessonDoc,
    input: SlideCardInput | undefined,
    kind: 'cover' | 'outro',
    partTitle: string,
    logoUrl: string | undefined,
    slides: Array<{ index: number; imageKey: string }>,
    clips: Array<{ index: number; clipKey?: string; durationSec?: number }>,
  ): Promise<SlideVideoCard | undefined> {
if (!input) return undefined;
    const language = isLibrary(doc.courseId)
      ? ((await this.slides.loadManifest(tenantId, doc.courseId, doc.importId)).language ?? 'it')
      : await this.courseLanguage(tenantId, doc.courseId, doc.importId);
    const thanks: Record<string, string> = {
      it: 'Grazie per l’attenzione',
      en: 'Thank you',
      fr: 'Merci de votre attention',
      de: 'Vielen Dank für Ihre Aufmerksamkeit',
      es: 'Gracias por su atención',
    };
    const lang = language.toLowerCase().slice(0, 2);
    const fallbackThanks = thanks[lang] ?? thanks.it ?? '';
    const title = input.title?.trim() || (kind === 'cover' ? partTitle : fallbackThanks);
    let background: SlideVideoCard['background'];
    const bg = input.background;
    if (bg?.kind === 'slide') {
      const slide = slides.find((s) => s.index === bg.index);
      if (slide) {
        background = { kind: 'slide', imageUrl: await this.storage.getSignedUrl(slide.imageKey, { expiresInSec: MEDIA_URL_TTL_SEC }) };
      }
    } else if (bg?.kind === 'frame') {
      const clip = clips.find((c) => c.index === bg.index);
      if (clip?.clipKey) {
        const maxAt = Math.max(0, (clip.durationSec ?? bg.atSec) - 0.2);
        background = {
          kind: 'frame',
          clipUrl: await this.storage.getSignedUrl(clip.clipKey, { expiresInSec: MEDIA_URL_TTL_SEC }),
          atSec: Math.min(bg.atSec, maxAt),
        };
      }
    }
    return { title, subtitle: input.subtitle?.trim() || undefined, durationSec: kind === 'cover' ? 4 : 5, logoUrl, background };
  }

  private async readCues(part: LessonPart): Promise<Array<{ id: string; start: number; end: number; text: string }>> {
    if (!part.transcriptKey || !(await this.storage.exists(part.transcriptKey))) return [];
    const cues = JSON.parse((await this.storage.getObject(part.transcriptKey)).toString('utf8')) as Array<{
      id: string;
      start: number;
      end: number;
      text: string;
    }>;
    return cues.map((c) => ({ id: c.id, start: c.start, end: c.end, text: c.text }));
  }

  /** Libreria: salva il video montato come VideoAsset con la trascrizione della timeline. */
  private async createLibraryVideo(tenantId: string, doc: SlideLessonDoc, part: LessonPart): Promise<void> {
    const manifest = await this.slides.loadManifest(tenantId, doc.courseId, doc.importId);
    const row = await this.prisma.videoAsset.create({
      data: {
        tenantId,
        title: part.title.slice(0, 140),
        source: 'UPLOAD',
        storageKey: part.videoKey!,
        mimeType: 'video/mp4',
        durationSec: part.videoDurationSec ? Math.round(part.videoDurationSec) : null,
        channel: (doc.moduleTitle || manifest.filename.replace(/\.[^.]+$/, '')).slice(0, 140) || null,
        transcript: await this.readCues(part),
        transcriptStatus: 'READY',
        slideImportId: doc.importId,
      },
      select: { id: true },
    });
    part.videoAssetId = row.id;
    await this.save(tenantId, doc);
  }

  /** Libreria: dopo un rimontaggio aggiorna file, durata e trascrizione del VideoAsset esistente. */
  private async updateLibraryVideo(tenantId: string, part: LessonPart): Promise<void> {
    if (!part.videoAssetId) throw new Error(`Video di libreria mancante per «${part.title}»`);
    const res = await this.prisma.videoAsset.updateMany({
      where: { id: part.videoAssetId, tenantId },
      data: {
        storageKey: part.videoKey!,
        durationSec: part.videoDurationSec ? Math.round(part.videoDurationSec) : null,
        transcript: await this.readCues(part),
        transcriptStatus: 'READY',
      },
    });
    if (res.count === 0) throw new Error(`Il video «${part.title}» non è più in libreria`);
  }

  /** Sostituisce il video nel blocco video della lezione esistente, lasciando intatto il resto. */
  private async swapVideo(tenantId: string, doc: SlideLessonDoc, part: LessonPart): Promise<void> {
    if (!part.lessonId || !part.moduleId) throw new Error(`Lezione mancante per «${part.title}»`);
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: part.lessonId, module: { id: part.moduleId, course: { id: doc.courseId, tenantId } } },
      select: { blocks: true },
    });
    if (!lesson || !Array.isArray(lesson.blocks)) throw new Error(`Lezione non trovata per «${part.title}»`);
    const blocks = lesson.blocks as Array<{ type?: string; payload?: { video?: { storageKey?: string } } }>;
    const vc = blocks.find((b) => b.type === 'video_checkpoint');
    if (!vc?.payload?.video) throw new Error(`Blocco video non trovato per «${part.title}»`);
    vc.payload.video.storageKey = part.videoKey;
    // Con clip rigenerate (es. cambio avatar) i tempi del parlato cambiano: si aggiorna anche
    // la trascrizione, ricavata dalla stessa timeline del nuovo montaggio.
    if (part.transcriptKey && (await this.storage.exists(part.transcriptKey))) {
      const cues = JSON.parse((await this.storage.getObject(part.transcriptKey)).toString('utf8')) as Array<{
        id: string;
        start: number;
        end: number;
        text: string;
      }>;
      const payload = vc.payload as Record<string, unknown>;
      payload.transcript = cues.map((c) => ({ id: c.id, start: c.start, end: c.end, text: c.text }));
      payload.transcriptStatus = 'ready';
    }
    await this.modules.setLessonBlocks(tenantId, doc.courseId, part.moduleId, part.lessonId, blocks as unknown as Block[]);
  }

  // --- Passo 2: riepilogo e punti chiave ------------------------------------

  private async stepSummary(tenantId: string, doc: SlideLessonDoc, part: LessonPart): Promise<void> {
    doc.step = 'summary';
    await this.save(tenantId, doc);
    const narration = await this.narrationText(tenantId, doc, part);
    const language = await this.courseLanguage(tenantId, doc.courseId, doc.importId);
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
    const language = await this.courseLanguage(tenantId, doc.courseId, doc.importId);
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

  private async courseLanguage(tenantId: string, courseId: string, importId: string): Promise<string> {
    if (isLibrary(courseId)) return (await this.slides.loadManifest(tenantId, courseId, importId)).language ?? 'it';
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
        courseId: meterCourseId(courseId),
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
      pipPosition: doc.pipPosition ?? 'bottom-right',
      slidePositions: doc.slidePositions ?? {},
      slideShots: doc.slideShots ?? {},
      avatarFrame: doc.avatarFrame ?? {},
      burnCaptions: doc.burnCaptions ?? true,
      cover: doc.cover,
      outro: doc.outro,
      brandId: doc.brandId,
      moduleTitle: doc.moduleTitle,
      mode: doc.mode,
      remaster: doc.remaster === true,
      currentPart: doc.currentPart,
      parts: doc.parts.map((p) => ({
        id: p.id,
        title: p.title,
        done: isLibrary(doc.courseId) ? Boolean(p.videoAssetId) : p.quizReady === true,
        moduleId: p.moduleId,
        lessonId: p.lessonId,
        videoAssetId: p.videoAssetId,
      })),
      moduleId: doc.parts[0]?.moduleId,
      lessonId: doc.parts[0]?.lessonId,
    };
  }
}

/** Luminanza relativa di un colore esadecimale (0 nero, 1 bianco); -1 se non è un colore valido. */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return -1;
  const h = m[1]!.length === 3 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!;
  const n = parseInt(h, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'errore sconosciuto';
}
