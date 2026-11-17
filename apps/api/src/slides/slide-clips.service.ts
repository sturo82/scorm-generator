import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotImplementedException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import {
  DEFAULT_HEYGEN_ENGINE,
  heygenCostPerMinUsd,
  heygenEngineSupports,
  isHeyGenEngineId,
  type HeyGenAvatarBillingType,
  type PronunciationEntry,
  type StartSlideClips,
} from '@scorm/contracts';
import type { ObjectStorage, VideoGenerationProvider } from '@scorm/domain';
import type { AppConfig } from '../config/configuration.js';
import { UsageMeterService } from '../metering/usage-meter.service.js';
import { OBJECT_STORAGE, VIDEO_GEN_PROVIDER } from '../providers/provider.constants.js';
import { SlideScriptsService } from './slide-scripts.service.js';
import { meterCourseId } from './slide-owner.js';
import { applyGlossary, restoreGlossary } from './slide-glossary.js';

const CONCURRENCY = 3;
const POLL_INTERVAL_MS = 8_000;
const JOB_TIMEOUT_MS = 20 * 60_000;
const MAX_ATTEMPTS = 3;
const LEASE_MS = 90_000;
const HEARTBEAT_MS = 30_000;
const PREVIEW_URL_TTL_SEC = 6 * 3600;

type ClipState = 'pending' | 'processing' | 'completed' | 'failed';

export interface SlideClip {
  index: number;
  /** Impronta del copione con cui è stata generata la clip (per rigenerare solo ciò che cambia). */
  scriptHash: string;
  state: ClipState;
  jobRef?: string;
  attempts: number;
  error?: string;
  clipKey?: string;
  srtKey?: string;
  durationSec?: number;
}

export interface SlideClipsDoc {
  importId: string;
  courseId: string;
  status: 'running' | 'completed' | 'failed';
  avatarId: string;
  avatarType: HeyGenAvatarBillingType;
  voiceId?: string;
  engine: string;
  resolution: string;
  language: string;
  createdAt: string;
  updatedAt: string;
  /** Lease di esecuzione: evita che due istanze API portino avanti lo stesso lavoro. */
  owner?: string;
  leaseUntil?: number;
  clips: SlideClip[];
}

export interface SlideClipsView extends Omit<SlideClipsDoc, 'owner' | 'leaseUntil' | 'clips'> {
  clips: Array<SlideClip & { clipUrl?: string }>;
  progress: { total: number; completed: number; failed: number; processing: number };
  totalDurationSec: number;
}

export interface SlideClipsEstimate {
  slides: number;
  minutes: number;
  costUsd: number;
  engine: string;
  avatarType: HeyGenAvatarBillingType;
  maxMinutes: number;
}

function hashScript(script: string): string {
  return createHash('sha256').update(script.trim()).digest('hex').slice(0, 16);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Fase 3 della pipeline "slide + avatar": una clip HeyGen per slide, a copioni
 * approvati. Lo stato vive in `clips.json` accanto all'import (non in un
 * GenerationJob: `recoverStaleJobs` marcherebbe FAILED i job lunghi al riavvio).
 * Ogni jobRef viene persistito appena creato, così dopo un riavvio si riprende il
 * polling invece di pagare di nuovo; la ripresa avviene alla prima lettura dello
 * stato (la UI fa polling). Un lease evita l'esecuzione doppia fra istanze.
 */
@Injectable()
export class SlideClipsService {
  private readonly logger = new Logger(SlideClipsService.name);
  private readonly instanceId = randomUUID();
  private readonly active = new Set<string>();
  private readonly saveChains = new Map<string, Promise<void>>();

  constructor(
    private readonly scripts: SlideScriptsService,
    private readonly meter: UsageMeterService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Optional() @Inject(VIDEO_GEN_PROVIDER) private readonly videoGen: VideoGenerationProvider | null,
  ) {}

  private prefix(tenantId: string, courseId: string, importId: string): string {
    return `media/${tenantId}/${courseId}/slides/${importId}`;
  }
  private docKey(tenantId: string, courseId: string, importId: string): string {
    return `${this.prefix(tenantId, courseId, importId)}/clips.json`;
  }
  private runKey(tenantId: string, importId: string): string {
    return `${tenantId}:${importId}`;
  }

  /** Stima minuti e costo delle clip ancora da generare (copioni correnti). */
  async estimate(
    tenantId: string,
    courseId: string,
    importId: string,
    engineInput?: string,
    avatarTypeInput: HeyGenAvatarBillingType = 'digital_twin',
    /** True per il cambio avatar: si rigenerano tutte le clip incluse. */
    all = false,
  ): Promise<SlideClipsEstimate> {
    const scripts = await this.scripts.get(tenantId, courseId, importId);
    if (!scripts) throw new BadRequestException('Genera prima i copioni');
    const engine = this.resolveEngine(engineInput, avatarTypeInput);
    const existing = await this.load(tenantId, courseId, importId);
    const todo = scripts.slides.filter((s) => {
      if (s.skip) return false;
      if (all) return true;
      const done = existing?.clips.find((c) => c.index === s.index);
      return !(done?.state === 'completed' && done.scriptHash === hashScript(applyGlossary(s.script, scripts.glossary)));
    });
    // Con clip già generate la durata reale è più affidabile della stima dal numero di parole.
    const minutes =
      todo.reduce((n, s) => {
        const real = existing?.clips.find((c) => c.index === s.index)?.durationSec;
        return n + (real && real > 0 ? real : s.estSec);
      }, 0) / 60;
    return {
      slides: todo.length,
      minutes: Math.round(minutes * 10) / 10,
      costUsd: Math.round(minutes * heygenCostPerMinUsd(engine, avatarTypeInput) * 100) / 100,
      engine,
      avatarType: avatarTypeInput,
      maxMinutes: this.config.get('heygen', { infer: true }).slideClipMaxMinutes,
    };
  }

  /**
   * Avvia (o riprende) la generazione. Con clip già esistenti rigenera solo le
   * slide fallite, mai generate o il cui copione è cambiato dopo la clip.
   */
  async start(
    tenantId: string,
    courseId: string,
    importId: string,
    input: StartSlideClips,
  ): Promise<SlideClipsView> {
    if (!this.videoGen) throw new NotImplementedException('Generazione video avatar non configurata');
    const scripts = await this.scripts.get(tenantId, courseId, importId);
    if (!scripts) throw new BadRequestException('Genera prima i copioni');
    if (scripts.status !== 'approved') {
      throw new ConflictException('I copioni vanno approvati prima di generare le clip.');
    }
    const existing = await this.load(tenantId, courseId, importId);
    if (existing && this.isLeased(existing)) {
      throw new ConflictException('Generazione già in corso per questo import.');
    }

    // Se esiste un lavoro precedente si mantengono le sue impostazioni (avatar, engine, voce):
    // clip di avatar o engine diversi nello stesso video sarebbero incoerenti.
    const avatarType = (existing?.avatarType ?? input.avatarType) as HeyGenAvatarBillingType;
    const engine = existing?.engine ?? this.resolveEngine(input.engine, avatarType);
    const est = await this.estimate(tenantId, courseId, importId, engine, avatarType);
    if (est.minutes > est.maxMinutes) {
      throw new BadRequestException(
        `Stima ${est.minutes} min di video, oltre il tetto di ${est.maxMinutes} min per esecuzione.`,
      );
    }

    const cfg = this.config.get('heygen', { infer: true });
    const now = new Date().toISOString();
    const clips: SlideClip[] = scripts.slides
      .filter((s) => !s.skip)
      .map((s) => {
        const hash = hashScript(applyGlossary(s.script, scripts.glossary));
        const prev = existing?.clips.find((c) => c.index === s.index);
        // Una clip completata, o con un job HeyGen già avviato (jobRef), si conserva: rigenerarla
        // significherebbe pagarla due volte.
        if (prev && prev.scriptHash === hash && (prev.state === 'completed' || (prev.state === 'processing' && prev.jobRef))) {
          return prev;
        }
        return { index: s.index, scriptHash: hash, state: 'pending' as const, attempts: 0 };
      });
    const doc: SlideClipsDoc = {
      importId,
      courseId,
      status: 'running',
      avatarId: existing?.avatarId ?? input.avatarId,
      avatarType,
      voiceId: existing?.voiceId ?? input.voiceId,
      engine,
      resolution: existing?.resolution ?? input.resolution ?? cfg.resolution ?? '720p',
      language: scripts.language,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      clips,
    };
    await this.save(tenantId, doc);
    this.launch(tenantId, courseId, importId);
    return this.toView(doc);
  }

  /**
   * Cambia avatar (e voce/engine) di un video già generato: rigenera TUTTE le clip incluse con
   * il nuovo avatar, mantenendo copioni, slide e regia. I video delle lezioni si aggiornano poi
   * con il rimontaggio, che aggiorna anche la trascrizione (i tempi del parlato cambiano).
   */
  async changeAvatar(
    tenantId: string,
    courseId: string,
    importId: string,
    input: StartSlideClips,
  ): Promise<SlideClipsView> {
    if (!this.videoGen) throw new NotImplementedException('Generazione video avatar non configurata');
    const existing = await this.load(tenantId, courseId, importId);
    if (!existing) throw new BadRequestException('Non ci sono clip da sostituire: generale prima.');
    if (this.isLeased(existing)) throw new ConflictException('Generazione già in corso per questo import.');
    const scripts = await this.scripts.get(tenantId, courseId, importId);
    if (!scripts || scripts.status !== 'approved') {
      throw new ConflictException('I copioni vanno approvati prima di generare le clip.');
    }
    const avatarType = input.avatarType as HeyGenAvatarBillingType;
    const engine = this.resolveEngine(input.engine, avatarType);
    const est = await this.estimate(tenantId, courseId, importId, engine, avatarType, true);
    if (est.minutes > est.maxMinutes) {
      throw new BadRequestException(
        `Stima ${est.minutes} min di video, oltre il tetto di ${est.maxMinutes} min per esecuzione.`,
      );
    }
    const cfg = this.config.get('heygen', { infer: true });
    const now = new Date().toISOString();
    const doc: SlideClipsDoc = {
      ...existing,
      status: 'running',
      avatarId: input.avatarId,
      avatarType,
      voiceId: input.voiceId,
      engine,
      resolution: input.resolution ?? existing.resolution ?? cfg.resolution ?? '720p',
      updatedAt: now,
      clips: scripts.slides
        .filter((s) => !s.skip)
        .map((s) => ({ index: s.index, scriptHash: hashScript(applyGlossary(s.script, scripts.glossary)), state: 'pending' as const, attempts: 0 })),
    };
    await this.save(tenantId, doc);
    this.logger.log(`Cambio avatar import ${importId}: ${doc.clips.length} clip con ${input.avatarId}`);
    this.launch(tenantId, courseId, importId);
    return this.toView(doc);
  }

  /** Stato corrente. Se il lavoro risulta orfano (lease scaduto) lo riprende. */
  async status(tenantId: string, courseId: string, importId: string): Promise<SlideClipsView | null> {
    await this.scripts.get(tenantId, courseId, importId); // verifica corso/import
    const doc = await this.load(tenantId, courseId, importId);
    if (!doc) return null;
    if (doc.status === 'running' && !this.active.has(this.runKey(tenantId, importId)) && !this.isLeased(doc)) {
      this.logger.log(`Ripresa generazione clip orfana (import ${importId})`);
      this.launch(tenantId, courseId, importId);
    }
    return this.toView(doc);
  }

  /** True se un runner (di questo o di un altro processo) ha un lease valido sul lavoro. */
  private isLeased(doc: SlideClipsDoc): boolean {
    return doc.status === 'running' && (doc.leaseUntil ?? 0) > Date.now();
  }

  private resolveEngine(engineInput: string | undefined, avatarType: HeyGenAvatarBillingType) {
    const cfgEngine = (this.config.get('heygen', { infer: true }).engine || DEFAULT_HEYGEN_ENGINE).toLowerCase();
    const engine = (engineInput ?? cfgEngine).toLowerCase();
    if (!isHeyGenEngineId(engine)) throw new BadRequestException(`Engine non valido: ${engine}`);
    if (!heygenEngineSupports(engine, avatarType)) {
      throw new BadRequestException(`L'engine ${engine} non supporta avatar ${avatarType}`);
    }
    return engine;
  }

  /** Avvia il runner in background (una sola volta per processo e import). */
  private launch(tenantId: string, courseId: string, importId: string): void {
    const key = this.runKey(tenantId, importId);
    if (this.active.has(key)) return;
    this.active.add(key);
    void this.run(tenantId, courseId, importId)
      .catch((err) => this.logger.error(`Runner clip fallito (import ${importId}): ${errMsg(err)}`))
      .finally(() => this.active.delete(key));
  }

  private async run(tenantId: string, courseId: string, importId: string): Promise<void> {
    const doc = await this.load(tenantId, courseId, importId);
    if (!doc || doc.status !== 'running') return;
    const scripts = await this.scripts.get(tenantId, courseId, importId);
    if (!scripts) return;
    // Alla voce arriva il testo con la pronuncia del glossario; slide e sottotitoli restano con i termini originali.
    const scriptByIndex = new Map(scripts.slides.map((s) => [s.index, applyGlossary(s.script, scripts.glossary)]));

    const heartbeat = setInterval(() => void this.save(tenantId, doc).catch(() => undefined), HEARTBEAT_MS);
    try {
      const queue = doc.clips.filter((c) => c.state !== 'completed' && c.state !== 'failed');
      const worker = async (): Promise<void> => {
        for (;;) {
          const clip = queue.shift();
          if (!clip) return;
          await this.processClip(tenantId, doc, clip, scriptByIndex.get(clip.index) ?? '', scripts.glossary);
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    } finally {
      clearInterval(heartbeat);
    }
    const failed = doc.clips.some((c) => c.state === 'failed');
    doc.status = failed ? 'failed' : 'completed';
    doc.owner = undefined;
    doc.leaseUntil = undefined;
    await this.save(tenantId, doc, false);
    this.logger.log(`Clip slide import ${importId}: ${doc.status}`);
  }

  private async processClip(
    tenantId: string,
    doc: SlideClipsDoc,
    clip: SlideClip,
    script: string,
    glossary: PronunciationEntry[] | undefined,
  ): Promise<void> {
    const prefix = this.prefix(tenantId, doc.courseId, doc.importId);
    while (clip.state !== 'completed' && clip.state !== 'failed') {
      try {
        if (!clip.jobRef) {
          const started = await this.videoGen!.startJob({
            script,
            avatarId: doc.avatarId,
            voiceId: doc.voiceId,
            resolution: doc.resolution,
            aspectRatio: '16:9',
            language: doc.language === 'italiano' ? 'it' : undefined,
            engine: doc.engine,
            caption: true,
          });
          clip.jobRef = started.jobRef;
          clip.state = 'processing';
          clip.error = undefined;
          await this.save(tenantId, doc); // jobRef persistito subito: niente doppio pagamento al riavvio
        }
        const deadline = Date.now() + JOB_TIMEOUT_MS;
        for (;;) {
          const res = await this.videoGen!.fetchJob(clip.jobRef);
          if (res.status === 'completed') {
            const n = String(clip.index).padStart(3, '0');
            const video = await download(res.videoUrl);
            clip.clipKey = `${prefix}/clips/${n}.mp4`;
            await this.storage.putObject(clip.clipKey, video.bytes, { contentType: 'video/mp4' });
            if (res.subtitleUrl) {
              try {
                const srt = await download(res.subtitleUrl);
                clip.srtKey = `${prefix}/clips/${n}.srt`;
                const srtText = restoreGlossary(Buffer.from(srt.bytes).toString('utf8'), glossary);
                await this.storage.putObject(clip.srtKey, Buffer.from(srtText, 'utf8'), { contentType: 'application/x-subrip' });
              } catch (e) {
                this.logger.warn(`Sottotitoli slide ${clip.index} non scaricati: ${errMsg(e)}`);
              }
            }
            clip.durationSec = res.durationSec;
            clip.state = 'completed';
            clip.error = undefined;
            await this.meter.record({
              tenantId,
              courseId: meterCourseId(doc.courseId),
              provider: 'HEYGEN',
              model: `heygen-${doc.engine}-${doc.avatarType}`,
              unit: 'SECONDS',
              quantity: Math.max(1, Math.ceil(res.durationSec ?? 0)),
              source: 'slide_clip',
              region: 'global',
            });
            await this.save(tenantId, doc);
            return;
          }
          if (res.status === 'failed') throw new Error(res.reason);
          if (Date.now() > deadline) throw new Error('Timeout generazione clip');
          await sleep(POLL_INTERVAL_MS);
        }
      } catch (err) {
        clip.attempts += 1;
        clip.error = errMsg(err);
        clip.jobRef = undefined; // un nuovo tentativo riparte da un job nuovo
        this.logger.warn(`Clip slide ${clip.index} tentativo ${clip.attempts}/${MAX_ATTEMPTS}: ${clip.error}`);
        if (clip.attempts >= MAX_ATTEMPTS || isPermanentError(clip.error)) {
          clip.state = 'failed';
        } else {
          clip.state = 'pending';
          await sleep(5_000 * clip.attempts);
        }
        await this.save(tenantId, doc);
      }
    }
  }

  private async load(tenantId: string, courseId: string, importId: string): Promise<SlideClipsDoc | null> {
    const key = this.docKey(tenantId, courseId, importId);
    if (!(await this.storage.exists(key))) return null;
    return JSON.parse((await this.storage.getObject(key)).toString('utf8')) as SlideClipsDoc;
  }

  /** Scritture serializzate per import (più worker aggiornano lo stesso documento). */
  private save(tenantId: string, doc: SlideClipsDoc, lease = true): Promise<void> {
    if (lease) {
      doc.owner = this.instanceId;
      doc.leaseUntil = Date.now() + LEASE_MS;
    }
    doc.updatedAt = new Date().toISOString();
    const key = this.docKey(tenantId, doc.courseId, doc.importId);
    const body = Buffer.from(JSON.stringify(doc));
    const prev = this.saveChains.get(key) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(() => this.storage.putObject(key, body, { contentType: 'application/json' }));
    this.saveChains.set(key, next);
    return next;
  }

  private async toView(doc: SlideClipsDoc): Promise<SlideClipsView> {
    const { owner: _o, leaseUntil: _l, clips, ...rest } = doc;
    const withUrls = await Promise.all(
      clips.map(async (c) => ({
        ...c,
        clipUrl: c.clipKey
          ? await this.storage.getSignedUrl(c.clipKey, { expiresInSec: PREVIEW_URL_TTL_SEC })
          : undefined,
      })),
    );
    return {
      ...rest,
      clips: withUrls,
      progress: {
        total: clips.length,
        completed: clips.filter((c) => c.state === 'completed').length,
        failed: clips.filter((c) => c.state === 'failed').length,
        processing: clips.filter((c) => c.state === 'processing').length,
      },
      totalDurationSec: clips.reduce((n, c) => n + (c.durationSec ?? 0), 0),
    };
  }
}

async function download(url: string): Promise<{ bytes: Buffer }> {
  if (url.startsWith('data:')) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
    if (!m) throw new Error('data: URL non valido');
    return { bytes: m[2] ? Buffer.from(m[3] ?? '', 'base64') : Buffer.from(decodeURIComponent(m[3] ?? ''), 'utf8') };
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download ${res.status}`);
  return { bytes: Buffer.from(await res.arrayBuffer()) };
}

/**
 * Errori che un nuovo tentativo non risolve (consenso mancante, avatar inesistente,
 * credenziali, crediti): inutile ripetere e rischioso, si fallisce subito.
 */
function isPermanentError(msg: string): boolean {
  return /consent|not[_ ]found|unauthori[sz]ed|forbidden|insufficient|credit|quota|invalid|required|non specificato/i.test(msg);
}

function errMsg(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) return cause.message;
    return err.message;
  }
  return 'errore sconosciuto';
}
