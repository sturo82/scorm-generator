import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import type {
  AvatarLookStatus,
  AvatarOption,
  CreateAvatarResult,
  ImageProvider,
  LLMProvider,
  ObjectStorage,
  Page,
  SpeechProvider,
  TranscriptionProvider,
  TextToVideoProvider,
  VideoGenerationProvider,
  VoiceOption,
} from '@scorm/domain';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_HEYGEN_ENGINE, defaultEngineForAvatarType } from '@scorm/contracts';
import type { AppConfig } from '../config/configuration.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageMeterService } from '../metering/usage-meter.service.js';
import {
  IMAGE_PROVIDER,
  LLM_PROVIDER,
  OBJECT_STORAGE,
  SPEECH_PROVIDER,
  TRANSCRIPTION_PROVIDER,
  VIDEO_GEN_PROVIDER,
  CARTOON_VIDEO_PROVIDER,
} from '../providers/provider.constants.js';
import {
  collectCartoonScenes,
  findCartoonScene,
  isPlaceholderVideo,
} from './cartoon-scenes.js';

/** Contesto di attribuzione costi passato alle operazioni media. */
interface MeterCtx {
  tenantId: string;
  courseId: string;
}

/** Durata dell'URL firmato per l'anteprima dei media. */
const MEDIA_URL_TTL_SEC = 6 * 3600;

/**
 * Mappa il codice lingua del corso (it/en/…) al locale BCP-47 per il TTS.
 * NB: non basta `${lang}-${LANG}` (produrrebbe "en-EN", locale inesistente).
 * Le voci Polly sono scelte dall'adapter in base al locale.
 */
const TTS_LOCALE: Record<string, string> = {
  it: 'it-IT',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
};

export function ttsLocale(code?: string | null): string {
  const key = (code ?? '').slice(0, 2).toLowerCase();
  return TTS_LOCALE[key] ?? 'it-IT';
}

/**
 * Mappa il codice lingua del corso (it/en/…) al LOCALE richiesto da Amazon
 * Transcribe (es. "it-IT"). Se il codice è già un locale valido (contiene "-")
 * lo passa invariato. Se la lingua è sconosciuta ritorna undefined, così
 * l'adapter ricade sull'auto-detect (IdentifyLanguage) invece di forzare un
 * locale errato e far fallire il job con un errore di validazione.
 */
const ASR_LOCALE: Record<string, string> = {
  it: 'it-IT',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  pt: 'pt-PT',
  nl: 'nl-NL',
  ja: 'ja-JP',
  ru: 'ru-RU',
  pl: 'pl-PL',
  tr: 'tr-TR',
  ar: 'ar-SA',
  hi: 'hi-IN',
};

export function asrLocale(code?: string | null): string | undefined {
  const raw = (code ?? '').trim();
  if (!raw) return undefined;
  // Già un locale (es. "it-IT"): passalo invariato.
  if (raw.includes('-')) return raw;
  return ASR_LOCALE[raw.slice(0, 2).toLowerCase()];
}

/** Timeout e intervallo del polling dei job di trascrizione (lato servizio). */
const TRANSCRIPTION_POLL_TIMEOUT_MS = 15 * 60_000;
const TRANSCRIPTION_POLL_INTERVAL_MS = 5_000;

/**
 * Timeout e intervallo del polling dei job di generazione video (HeyGen). Il
 * rendering può richiedere diversi minuti; teniamo un timeout ampio (20 min) e
 * un intervallo di 10s per non martellare l'API.
 */
const VIDEOGEN_POLL_TIMEOUT_MS = 20 * 60_000;
const VIDEOGEN_POLL_INTERVAL_MS = 10_000;

/**
 * Avvio dei job cartoon: su provider Bedrock Marketplace (es. Luma Ray) il
 * PRIMO StartAsyncInvoke può fallire perché la sottoscrizione Marketplace è
 * ancora in attivazione ("try again after 5 minutes"), e più avvii ravvicinati
 * possono incorrere in throttling. Ritentiamo con backoff gli errori TRANSITORI.
 */
const CARTOON_START_MAX_ATTEMPTS = 6;
const CARTOON_START_BACKOFF_MS = [5_000, 15_000, 30_000, 45_000, 60_000];

/** Parole massime del copione per restare entro ~1 minuto di parlato (Free). */
const VIDEO_SCRIPT_MAX_WORDS = 140;

interface MediaRefLike {
  kind?: string;
  storageKey?: string;
  alt?: string;
  placeholderPrompt?: string;
  source?: string;
  externalUrl?: string;
  externalId?: string;
}

export interface GenerateImagesResult {
  generated: number;
  skipped: number;
  failed: number;
  /** Messaggi diagnostici per i media non generati (es. filtro contenuti). */
  warnings: string[];
}

export interface GenerateNarrationResult {
  url: string;
  bytes: number;
  voice: string;
}

/** Esito dell'avvio della generazione di un video avatar per un concetto. */
export interface GenerateConceptVideoResult {
  /** Stato iniziale: 'processing' (rendering in corso), seguito via polling. */
  status: 'processing';
  /** Id del block video_checkpoint che ospiterà il video. */
  blockId: string;
  /** Riferimento al job del provider (video_id HeyGen), per audit. */
  jobRef: string;
  /** Quanti video restano nella quota mensile dopo questa richiesta. */
  remainingThisMonth: number;
}

/**
 * Generazione dei media (Requisito 4.2 / 5.5): sostituisce i placeholder delle
 * immagini nei block con immagini reali (ImageProvider) e produce la narrazione
 * audio della lezione (SpeechProvider). I file vivono su ObjectStorage; i block
 * vengono aggiornati con l'URL del media.
 */
@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(IMAGE_PROVIDER) private readonly images: ImageProvider,
    @Inject(SPEECH_PROVIDER) private readonly speech: SpeechProvider,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
    @Inject(TRANSCRIPTION_PROVIDER) private readonly transcription: TranscriptionProvider,
    private readonly meter: UsageMeterService,
    // Opzionale: null se PROVIDER_VIDEO non è configurato (o manca l'API key).
    // In quel caso generateConceptVideo risponde 501, come lo stock image.
    @Optional() @Inject(VIDEO_GEN_PROVIDER) private readonly videoGen: VideoGenerationProvider | null,
    // Opzionale: null se PROVIDER_CARTOON_VIDEO non è configurato. In quel caso
    // la generazione dei cartoon delle scene "pillole" risponde 501.
    @Optional() @Inject(CARTOON_VIDEO_PROVIDER) private readonly cartoonGen: TextToVideoProvider | null,
  ) {}

  /**
   * Traduce il prompt immagine in inglese e lo riscrive come illustrazione SENZA
   * testo. Due motivi: (1) Stable Image filtra i prompt non in inglese; (2) i
   * modelli diffusion rendono malissimo il testo dentro le immagini (lettere
   * finte/sgrammaticate), quindi le immagini devono essere puramente
   * illustrative e il testo resta nell'HTML. In caso di errore LLM ripiega sul
   * prompt originale con l'istruzione "no text" appesa.
   */
  private async toEnglishPrompt(prompt: string, meterCtx?: MeterCtx): Promise<string> {
    const noText =
      'Clean illustration with NO text, NO letters, NO words, NO numbers, NO captions, NO labels, NO signage, NO logos.';
    try {
      const result = await this.llm.generate({
        system:
          'You rewrite image-generation prompts into concise English for a diffusion model. ' +
          'Describe only the visual scene. Do NOT ask for any text, letters, words, captions, ' +
          'labels or signage in the image. Output ONLY the rewritten prompt, no quotes, no explanation.',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        maxTokens: 300,
      });
      // Metering del consumo LLM "nascosto" della riscrittura prompt immagine.
      if (meterCtx) {
        await this.meter.record({
          ...meterCtx,
          provider: 'BEDROCK_LLM',
          model: result.model,
          unit: 'INPUT_TOKENS',
          quantity: result.usage.inputTokens,
          source: 'image_prompt',
        });
        await this.meter.record({
          ...meterCtx,
          provider: 'BEDROCK_LLM',
          model: result.model,
          unit: 'OUTPUT_TOKENS',
          quantity: result.usage.outputTokens,
          source: 'image_prompt',
        });
      }
      const text = result.text.trim();
      return text.length > 0 ? `${text}. ${noText}` : `${prompt}. ${noText}`;
    } catch {
      return `${prompt}. ${noText}`;
    }
  }

  /**
   * Genera le immagini mancanti nei block della lezione: ogni MediaRef di tipo
   * image con storageKey vuoto e un prompt viene materializzato. Idempotente:
   * salta i media già risolti.
   */
  async generateLessonImages(
    tenantId: string,
    courseId: string,
    lessonId: string,
    force = false,
  ): Promise<GenerateImagesResult> {
    const lesson = await this.requireLesson(tenantId, courseId, lessonId);
    const blocks = Array.isArray(lesson.blocks) ? (lesson.blocks as unknown[]) : [];
    const media = this.config.get('media', { infer: true });
    const meterCtx: MeterCtx = { tenantId, courseId };

    let generated = 0;
    let skipped = 0;
    let failed = 0;
    const warnings: string[] = [];

    // Attraversa in profondità i block cercando i MediaRef immagine.
    const refs = this.collectImageRefs(blocks);
    for (const ref of refs) {
      // Con force si rigenerano anche i media già presenti (es. per sostituire
      // immagini non soddisfacenti); altrimenti si saltano.
      if (!force && ref.storageKey && ref.storageKey.length > 0) {
        skipped++;
        continue;
      }
      const prompt = ref.placeholderPrompt || ref.alt;
      if (!prompt) {
        skipped++;
        continue;
      }
      try {
        const englishPrompt = await this.toEnglishPrompt(prompt, meterCtx);
        const result = await this.images.generate({
          prompt: englishPrompt,
          negativePrompt: 'text, letters, words, captions, labels, watermark, signature, typography',
          width: media.imageWidth,
          height: media.imageHeight,
        });
        const ext = extForContentType(result.contentType);
        const key = `media/${tenantId}/${courseId}/img/${hash(prompt)}.${ext}`;
        await this.storage.putObject(key, Buffer.from(result.bytes), {
          contentType: result.contentType,
        });
        // Salva la CHIAVE S3 (non l'URL firmato): l'URL per l'anteprima è
        // risolto al volo alla lettura; l'export scarica dalla chiave.
        ref.storageKey = key;
        // Metering: 1 immagine generata.
        await this.meter.record({
          ...meterCtx,
          provider: 'BEDROCK_IMAGE',
          model: media.imageModelId,
          unit: 'IMAGES',
          quantity: 1,
          source: 'image',
        });
        generated++;
      } catch (err) {
        // Un fallimento sulla singola immagine (es. filtro contenuti del
        // provider) non deve interrompere la generazione delle altre.
        const cause = (err as { cause?: unknown }).cause;
        const causeMsg = cause instanceof Error ? cause.message : String(cause ?? '');
        const detail = causeMsg || (err instanceof Error ? err.message : String(err));
        this.logger.warn(
          `Immagine non generata (lezione ${lessonId}, prompt "${prompt.slice(0, 80)}"): ${detail}`,
        );
        warnings.push(`"${prompt.slice(0, 60)}…": ${detail}`);
        failed++;
      }
    }

    if (generated > 0) {
      await this.prisma.lesson.update({
        where: { id: lessonId },
        data: { blocks: blocks as object, updatedAt: new Date() },
      });
    }
    return { generated, skipped, failed, warnings };
  }

  /**
   * Genera l'immagine di copertina del corso dal titolo e dagli elementi del
   * brief. Salva su S3 e persiste la chiave su Course. Restituisce l'URL firmato
   * per l'anteprima. Formato panoramico (16:9), senza testo nell'immagine.
   */
  async generateCourseCover(tenantId: string, courseId: string): Promise<{ url: string }> {
    const course = await this.prisma.course.findFirst({ where: { id: courseId, tenantId } });
    if (!course) throw new NotFoundException('Corso non trovato');

    const brief = course.brief as { targetAudience?: string } | null;
    const basePrompt =
      `Copertina professionale per un corso e-learning intitolato "${course.title}". ` +
      (brief?.targetAudience ? `Pubblico: ${brief.targetAudience}. ` : '') +
      (course.description ? `Tema: ${course.description}. ` : '') +
      'Immagine concettuale moderna, pulita, adatta a una hero image.';

    const meterCtx: MeterCtx = { tenantId, courseId };
    const englishPrompt = await this.toEnglishPrompt(basePrompt, meterCtx);
    const result = await this.images.generate({
      prompt: englishPrompt,
      negativePrompt: 'text, letters, words, captions, labels, watermark, signature, typography',
      width: 1280,
      height: 720,
    });
    const ext = extForContentType(result.contentType);
    const key = `media/${tenantId}/${courseId}/cover.${ext}`;
    await this.storage.putObject(key, Buffer.from(result.bytes), { contentType: result.contentType });
    // Metering: 1 immagine (copertina).
    await this.meter.record({
      ...meterCtx,
      provider: 'BEDROCK_IMAGE',
      model: this.config.get('media', { infer: true }).imageModelId,
      unit: 'IMAGES',
      quantity: 1,
      source: 'cover',
    });
    await this.prisma.course.update({ where: { id: courseId }, data: { coverImageKey: key } });
    const url = await this.storage.getSignedUrl(key, { expiresInSec: MEDIA_URL_TTL_SEC });
    return { url };
  }

  /**
   * Genera l'immagine di copertina di un MODULO dal titolo del modulo e dal
   * contesto del corso. Salva su S3 e persiste la chiave su Module. Stesso
   * formato panoramico (16:9) e stesse regole "no text" della copertina corso.
   */
  async generateModuleCover(
    tenantId: string,
    courseId: string,
    moduleId: string,
  ): Promise<{ url: string }> {
    const module = await this.prisma.module.findFirst({
      where: { id: moduleId, courseId, course: { tenantId } },
      include: { course: true },
    });
    if (!module) throw new NotFoundException('Modulo non trovato');

    const basePrompt =
      `Immagine di copertina per il modulo "${module.title}" ` +
      `del corso e-learning "${module.course.title}". ` +
      (module.summary ? `Argomento del modulo: ${module.summary}. ` : '') +
      'Immagine concettuale moderna, pulita, adatta a una hero image di sezione.';

    const meterCtx: MeterCtx = { tenantId, courseId };
    const englishPrompt = await this.toEnglishPrompt(basePrompt, meterCtx);
    const result = await this.images.generate({
      prompt: englishPrompt,
      negativePrompt: 'text, letters, words, captions, labels, watermark, signature, typography',
      width: 1280,
      height: 720,
    });
    const ext = extForContentType(result.contentType);
    const key = `media/${tenantId}/${courseId}/modules/${moduleId}/cover.${ext}`;
    await this.storage.putObject(key, Buffer.from(result.bytes), { contentType: result.contentType });
    // Metering: 1 immagine (copertina modulo).
    await this.meter.record({
      ...meterCtx,
      provider: 'BEDROCK_IMAGE',
      model: this.config.get('media', { infer: true }).imageModelId,
      unit: 'IMAGES',
      quantity: 1,
      source: 'cover',
    });
    await this.prisma.module.update({ where: { id: moduleId }, data: { coverImageKey: key } });
    const url = await this.storage.getSignedUrl(key, { expiresInSec: MEDIA_URL_TTL_SEC });
    return { url };
  }

  /**
   * Genera la narrazione audio della lezione: concatena il testo dei block
   * rich_text, lo sintetizza con SpeechProvider e salva un MP3. Restituisce
   * l'URL del file (non modifica i block).
   */
  async generateLessonNarration(
    tenantId: string,
    courseId: string,
    lessonId: string,
    engineOverride?: 'standard' | 'neural',
  ): Promise<GenerateNarrationResult> {
    const lesson = await this.requireLesson(tenantId, courseId, lessonId);
    const course = await this.prisma.course.findFirst({ where: { id: courseId, tenantId } });
    const blocks = Array.isArray(lesson.blocks) ? (lesson.blocks as unknown[]) : [];

    const text = this.extractNarrationText(blocks);
    if (!text) throw new NotFoundException('Nessun testo narrabile nella lezione');

    // Risoluzione engine: override puntuale (C) → preferenza del corso (B) →
    // default dell'ambiente (SPEECH_ENGINE). Così l'autore può alzare la qualità
    // (neural) quando vuole, con un default sicuro/economico a livello istanza.
    const engine = this.resolveSpeechEngine(engineOverride, (course as { speechEngine?: string } | null)?.speechEngine);

    const result = await this.speech.synthesize({
      text,
      language: ttsLocale(course?.language),
      engine,
    });
    const key = `media/${tenantId}/${courseId}/audio/${lessonId}.mp3`;
    await this.storage.putObject(key, Buffer.from(result.bytes), {
      contentType: result.contentType,
    });
    // Metering: Polly fattura per carattere sintetizzato; il prezzo dipende
    // dall'engine EFFETTIVO usato (neural ~4x standard), quindi lo riportiamo.
    await this.meter.record({
      tenantId,
      courseId,
      provider: 'POLLY',
      model: `polly-${result.engine ?? engine}`,
      unit: 'CHARACTERS',
      quantity: text.length,
      source: 'narration',
    });
    // Persiste la chiave sulla lezione: l'anteprima/export risolvono il file.
    await this.prisma.lesson.update({ where: { id: lessonId }, data: { narrationKey: key } });
    const url = await this.storage.getSignedUrl(key, { expiresInSec: MEDIA_URL_TTL_SEC });
    return { url, bytes: result.bytes.byteLength, voice: result.voice };
  }

  /**
   * Risolve il motore TTS da usare: override puntuale → preferenza del corso →
   * default dell'ambiente. Valori non validi vengono ignorati a favore del
   * livello successivo.
   */
  private resolveSpeechEngine(
    override?: string | null,
    coursePref?: string | null,
  ): 'standard' | 'neural' {
    const valid = (v?: string | null): 'standard' | 'neural' | undefined =>
      v === 'standard' || v === 'neural' ? v : undefined;
    return (
      valid(override) ??
      valid(coursePref) ??
      this.config.get('media', { infer: true }).speechEngine
    );
  }

  /**
   * Carica un video dell'utente e lo associa a un MediaRef video di un block
   * della lezione (tipicamente un block "video_checkpoint" placeholder generato
   * dall'AI). Salva su object storage e scrive lo storageKey nel block; l'URL
   * firmato è risolto in lettura per anteprima e l'export SCORM lo embedda.
   */
  async uploadLessonVideo(
    tenantId: string,
    courseId: string,
    lessonId: string,
    blockId: string,
    file: { mimeType: string; content: Buffer },
  ): Promise<{ storageKey: string; url: string }> {
    const ext = extForVideoMime(file.mimeType);
    if (!ext) {
      throw new BadRequestException('Formato video non supportato (usa MP4 o WebM).');
    }
    const MAX_BYTES = 100 * 1024 * 1024;
    if (file.content.byteLength > MAX_BYTES) {
      throw new BadRequestException('Video troppo grande (max 100MB).');
    }
    const lesson = await this.requireLesson(tenantId, courseId, lessonId);
    const blocks = Array.isArray(lesson.blocks) ? (lesson.blocks as unknown[]) : [];

    // Trova il MediaRef video nel block indicato (per id). Fallback: il primo
    // MediaRef video presente nella lezione.
    const ref = this.findVideoRef(blocks, blockId);
    if (!ref) {
      throw new NotFoundException('Nessun segnaposto video trovato nella lezione per questo block');
    }

    const key = `media/${tenantId}/${courseId}/video/${randomUUID()}.${ext}`;
    await this.storage.putObject(key, file.content, { contentType: file.mimeType });
    ref.storageKey = key;
    // Upload = video caricato: sorgente 'upload' (abilita la trascrizione ASR).
    ref.source = 'upload';
    // Avvia il job ASR PRIMA di rispondere, così possiamo persistere il suo
    // riferimento (jobRef) nel block: in caso di riavvio del processo lo stato
    // è ripristinabile dal DB (vedi onModuleInit). Se il provider non supporta
    // i job asincroni (es. mock), si usa il percorso sincrono in background.
    const vcBlock = this.findVideoCheckpointBlock(blocks, blockId);
    let jobRef: string | undefined;
    if (vcBlock && typeof this.transcription.startJob === 'function') {
      try {
        const started = await this.transcription.startJob({ storageKey: key, contentType: file.mimeType });
        jobRef = started.jobRef;
      } catch (err) {
        this.logger.warn(`Avvio trascrizione fallito (lezione ${lessonId}): ${rawTranscriptionError(err)}`);
      }
    }
    if (vcBlock) {
      const payload = (vcBlock.payload ?? {}) as Record<string, unknown>;
      payload.transcriptStatus = 'processing';
      if (jobRef) payload.transcriptJobRef = jobRef;
      else delete payload.transcriptJobRef;
      delete payload.transcriptError;
      vcBlock.payload = payload;
    }
    await this.prisma.lesson.update({
      where: { id: lessonId },
      data: { blocks: blocks as object, updatedAt: new Date() },
    });
    const url = await this.storage.getSignedUrl(key, { expiresInSec: MEDIA_URL_TTL_SEC });

    // Trascrizione automatica (ASR) in BACKGROUND: non blocca la risposta.
    if (vcBlock) {
      const ctx = { tenantId, courseId, lessonId, blockId: vcBlock.id as string };
      if (jobRef) {
        void this.pollTranscriptionJob(ctx, jobRef);
      } else if (typeof this.transcription.startJob !== 'function') {
        // Provider sincrono (mock): percorso legacy start+attesa in un colpo.
        void this.transcribeVideoInBackground(ctx, key, file.mimeType);
      }
    }

    return { storageKey: key, url };
  }

  /**
   * Al boot ripristina i job di trascrizione lasciati in sospeso da un riavvio:
   * cerca i block video con transcriptStatus='processing' e un transcriptJobRef,
   * e riprende il polling. Senza questo, un riavvio durante l'attesa lascerebbe
   * lo stato bloccato su 'processing' per sempre. Best-effort e non bloccante.
   */
  async onModuleInit(): Promise<void> {
    // Riprende le trascrizioni ASR in sospeso (se il provider è asincrono).
    if (typeof this.transcription.fetchJob === 'function') {
      try {
        const pending = await this.findPendingTranscriptionJobs();
        if (pending.length > 0) {
          this.logger.log(`Ripresa ${pending.length} trascrizione/i in sospeso dopo il riavvio`);
          for (const job of pending) {
            void this.pollTranscriptionJob(
              { tenantId: job.tenantId, courseId: job.courseId, lessonId: job.lessonId, blockId: job.blockId },
              job.jobRef,
            );
          }
        }
      } catch (err) {
        this.logger.warn(`Ripresa trascrizioni non riuscita: ${err instanceof Error ? err.message : 'errore'}`);
      }
    }

    // Riprende le generazioni video (HeyGen) in sospeso dopo un riavvio.
    if (this.videoGen) {
      try {
        const pendingVideos = await this.findPendingVideoGenJobs();
        if (pendingVideos.length > 0) {
          this.logger.log(`Ripresa ${pendingVideos.length} generazione/i video in sospeso dopo il riavvio`);
          for (const job of pendingVideos) {
            void this.pollVideoGenJob(
              { tenantId: job.tenantId, courseId: job.courseId, lessonId: job.lessonId, blockId: job.blockId },
              job.jobRef,
            );
          }
        }
      } catch (err) {
        this.logger.warn(`Ripresa generazioni video non riuscita: ${err instanceof Error ? err.message : 'errore'}`);
      }
    }
  }

  /**
   * Esegue il polling di un job ASR già avviato (startJob) e, al termine,
   * scrive le cue o lo stato di errore nel block. Resiliente: usa fetchJob,
   * che funziona anche dopo un riavvio del processo. Best-effort.
   */
  private async pollTranscriptionJob(
    ctx: { tenantId: string; courseId: string; lessonId: string; blockId: string },
    jobRef: string,
  ): Promise<void> {
    const deadline = Date.now() + TRANSCRIPTION_POLL_TIMEOUT_MS;
    try {
      for (;;) {
        if (Date.now() > deadline) {
          await this.writeTranscript(
            ctx.tenantId,
            ctx.courseId,
            ctx.lessonId,
            ctx.blockId,
            [],
            'failed',
            'La trascrizione ha impiegato troppo tempo. Riprova o inserisci la trascrizione manualmente.',
          ).catch(() => undefined);
          return;
        }
        await sleep(TRANSCRIPTION_POLL_INTERVAL_MS);
        const r = await this.transcription.fetchJob!(jobRef);
        if (r.status === 'processing') continue;
        if (r.status === 'failed') {
          const reason = describeTranscriptionError(new Error(r.reason));
          this.logger.warn(`Trascrizione fallita (lezione ${ctx.lessonId}): ${r.reason}`);
          await this.writeTranscript(ctx.tenantId, ctx.courseId, ctx.lessonId, ctx.blockId, [], 'failed', reason).catch(
            () => undefined,
          );
          return;
        }
        await this.applyTranscriptionResult(ctx, r.result);
        return;
      }
    } catch (err) {
      const reason = describeTranscriptionError(err);
      this.logger.warn(`Polling trascrizione fallito (lezione ${ctx.lessonId}): ${rawTranscriptionError(err)}`);
      await this.writeTranscript(ctx.tenantId, ctx.courseId, ctx.lessonId, ctx.blockId, [], 'failed', reason).catch(
        () => undefined,
      );
    }
  }

  /** Converte il risultato ASR in cue, le scrive nel block e registra il costo. */
  private async applyTranscriptionResult(
    ctx: { tenantId: string; courseId: string; lessonId: string; blockId: string },
    result: { segments: Array<{ start: number; end: number; speaker?: string; text: string }> },
  ): Promise<void> {
    const cues = result.segments.map((s, i) => ({
      id: `cue-${i}`,
      start: s.start,
      end: s.end,
      ...(s.speaker ? { speaker: s.speaker } : {}),
      text: s.text,
    }));
    // Nessun segmento: NON scrivere una trascrizione finta. Stato 'none' così il
    // tab non appare e l'autore può inserire la trascrizione reale a mano.
    if (cues.length === 0) {
      await this.writeTranscript(ctx.tenantId, ctx.courseId, ctx.lessonId, ctx.blockId, [], 'none');
      this.logger.log(`Trascrizione non disponibile (lezione ${ctx.lessonId}): nessun segmento ASR`);
      return;
    }
    await this.writeTranscript(ctx.tenantId, ctx.courseId, ctx.lessonId, ctx.blockId, cues, 'ready');
    this.logger.log(`Trascrizione completata (lezione ${ctx.lessonId}): ${cues.length} segmenti`);
    // Metering: Transcribe fattura per secondo di audio. Stima la durata dal
    // tempo di fine dell'ultima cue (proxy affidabile dell'audio trascritto).
    const seconds = Math.ceil(cues.reduce((max, c) => Math.max(max, c.end ?? c.start), 0));
    if (seconds > 0) {
      void this.meter.record({
        tenantId: ctx.tenantId,
        courseId: ctx.courseId,
        provider: 'TRANSCRIBE',
        model: 'transcribe-batch',
        unit: 'SECONDS',
        quantity: seconds,
        source: 'video_transcript',
      });
    }
  }

  /**
   * Percorso legacy per i provider SINCRONI (senza startJob/fetchJob, es. mock):
   * avvia e attende la trascrizione in un unico await, poi scrive il risultato.
   */
  private async transcribeVideoInBackground(
    ctx: { tenantId: string; courseId: string; lessonId: string; blockId: string },
    storageKey: string,
    contentType: string,
  ): Promise<void> {
    try {
      const result = await this.transcription.transcribe({ storageKey, contentType });
      await this.applyTranscriptionResult(ctx, result);
    } catch (err) {
      const reason = describeTranscriptionError(err);
      this.logger.warn(`Trascrizione fallita (lezione ${ctx.lessonId}): ${rawTranscriptionError(err)}`);
      await this.writeTranscript(ctx.tenantId, ctx.courseId, ctx.lessonId, ctx.blockId, [], 'failed', reason).catch(
        () => undefined,
      );
    }
  }

  /** Scrive transcript + transcriptStatus nel block video_checkpoint indicato. */
  private async writeTranscript(
    tenantId: string,
    courseId: string,
    lessonId: string,
    blockId: string,
    transcript: Array<Record<string, unknown>>,
    status: 'ready' | 'failed' | 'none',
    transcriptError?: string,
  ): Promise<void> {
    const lesson = await this.requireLesson(tenantId, courseId, lessonId);
    const blocks = Array.isArray(lesson.blocks) ? (lesson.blocks as unknown[]) : [];
    const vcBlock = this.findVideoCheckpointBlock(blocks, blockId);
    if (!vcBlock) return;
    const payload = (vcBlock.payload ?? {}) as Record<string, unknown>;
    if (status === 'ready') payload.transcript = transcript;
    payload.transcriptStatus = status;
    // Allega/ripulisci il motivo del fallimento: presente solo per 'failed'.
    if (status === 'failed' && transcriptError) payload.transcriptError = transcriptError;
    else delete payload.transcriptError;
    // Stato terminale: rimuovi il riferimento al job così non viene ripreso al
    // prossimo riavvio (il job è concluso: ready/failed/none).
    delete payload.transcriptJobRef;
    vcBlock.payload = payload;
    await this.prisma.lesson.update({
      where: { id: lessonId },
      data: { blocks: blocks as object, updatedAt: new Date() },
    });
  }

  /**
   * Salva la trascrizione MANUALE del block video indicato (inserimento o
   * correzione da parte dell'autore, con i tempi reali del video). Imposta
   * transcriptStatus a 'ready' se ci sono cue, altrimenti 'none'. Ritorna la
   * lezione aggiornata non serve: ritorna un flag.
   */
  async setVideoTranscript(
    tenantId: string,
    courseId: string,
    lessonId: string,
    blockId: string,
    transcript: Array<{ id: string; start: number; end?: number; speaker?: string; text: string }>,
  ): Promise<{ saved: true; count: number }> {
    const lesson = await this.requireLesson(tenantId, courseId, lessonId);
    const blocks = Array.isArray(lesson.blocks) ? (lesson.blocks as unknown[]) : [];
    const vcBlock = this.findVideoCheckpointBlock(blocks, blockId);
    if (!vcBlock) throw new NotFoundException('Block video non trovato nella lezione');
    // Ordina le cue per tempo di inizio (il karaoke assume start crescenti).
    const sorted = [...transcript].sort((a, b) => a.start - b.start);
    const payload = (vcBlock.payload ?? {}) as Record<string, unknown>;
    payload.transcript = sorted;
    payload.transcriptStatus = sorted.length > 0 ? 'ready' : 'none';
    vcBlock.payload = payload;
    await this.prisma.lesson.update({
      where: { id: lessonId },
      data: { blocks: blocks as object, updatedAt: new Date() },
    });
    return { saved: true, count: sorted.length };
  }

  // === Generazione video avatar (HeyGen) ===================================

  /**
   * Elenca gli avatar UNA PAGINA alla volta (no quota). `source` separa gli
   * avatar dell'account ('mine') dal catalogo HeyGen ('stock'). `token` è il
   * cursore della pagina successiva; `query` cerca per nome. Ritorna gli item
   * e l'eventuale cursore per continuare.
   */
  async listVideoAvatars(opts?: {
    source?: 'mine' | 'stock';
    token?: string;
    query?: string;
  }): Promise<Page<AvatarOption>> {
    if (!this.videoGen) throw this.videoNotConfigured();
    return this.videoGen.listAvatarsPage({
      source: opts?.source,
      token: opts?.token,
      query: opts?.query,
    });
  }

  /**
   * Elenca le voci UNA PAGINA alla volta (no quota), filtrate per LINGUA DEL
   * CORSO di default (così l'autore vede subito le voci della lingua giusta).
   * `languageOverride='all'` mostra tutte le lingue; `token` pagina; `query` cerca.
   */
  async listVideoVoices(
    tenantId: string,
    courseId: string,
    opts?: { languageOverride?: string; token?: string; query?: string },
  ): Promise<Page<VoiceOption>> {
    if (!this.videoGen) throw this.videoNotConfigured();
    let language = opts?.languageOverride;
    if (language === 'all') {
      language = undefined;
    } else if (!language) {
      const course = await this.prisma.course.findFirst({
        where: { id: courseId, tenantId },
        select: { language: true },
      });
      language = course?.language ?? undefined;
    }
    return this.videoGen.listVoicesPage({ language, token: opts?.token, query: opts?.query });
  }

  // === Creazione / gestione avatar (HeyGen) ================================

  /**
   * Elenca gli avatar DELL'ACCOUNT ("mine"): quelli creati dal tenant (o
   * caricati nell'account HeyGen). Non consuma quota. È la lista mostrata nella
   * sezione Impostazioni → Avatar. Delega al provider (una chiamata, caching).
   */
  async listMyAvatars(query?: string, refresh = false): Promise<Page<AvatarOption>> {
    if (!this.videoGen) throw this.videoNotConfigured();
    return this.videoGen.listAvatarsPage({ source: 'mine', query, refresh });
  }

  /**
   * Crea un nuovo avatar HeyGen (foto o prompt) per il tenant. Operazione A
   * PAGAMENTO una tantum (HeyGen self-serve: ~$1.32 per photo avatar) e ASINCRONA: il
   * look parte in stato 'processing' e va atteso con getAvatarLook. Registra il
   * costo di creazione (metering, source 'avatar_creation', unità CALLS).
   *
   * `type='photo'` richiede l'immagine (bytes + contentType); `type='prompt'`
   * richiede il testo descrittivo. Ritorna avatarId (= look id da usare nella
   * generazione video) e groupId (per l'eliminazione).
   */
  async createAvatar(
    tenantId: string,
    input: { type: 'photo' | 'prompt'; name: string; image?: { bytes: Buffer; contentType: string }; prompt?: string },
  ): Promise<CreateAvatarResult> {
    if (!this.videoGen || typeof this.videoGen.createAvatar !== 'function') {
      throw this.videoNotConfigured();
    }
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Nome avatar mancante');
    if (input.type === 'photo') {
      if (!input.image) throw new BadRequestException('Immagine mancante per avatar foto (campo "file")');
      const ext = extForImageMime(input.image.contentType);
      if (!ext) throw new BadRequestException('Formato immagine non supportato (usa JPG o PNG).');
      const MAX_BYTES = 32 * 1024 * 1024; // limite HeyGen per POST /v3/assets
      if (input.image.bytes.byteLength > MAX_BYTES) {
        throw new BadRequestException('Immagine troppo grande (max 32MB).');
      }
    } else if (input.type === 'prompt') {
      if (!input.prompt?.trim()) throw new BadRequestException('Descrizione (prompt) mancante per avatar da prompt');
    } else {
      throw new BadRequestException('Tipo avatar non supportato (usa "photo" o "prompt")');
    }

    let result: CreateAvatarResult;
    try {
      result = await this.videoGen.createAvatar({
        type: input.type,
        name,
        image: input.image ? { bytes: input.image.bytes, contentType: input.image.contentType } : undefined,
        prompt: input.prompt?.trim(),
      });
    } catch (err) {
      const detail = rawVideoGenError(err);
      this.logger.warn(`Creazione avatar fallita (tenant ${tenantId}): ${detail}`);
      throw new BadRequestException(`Creazione avatar non riuscita: ${describeVideoGenError(detail)}`);
    }

    // Metering: 1 chiamata di creazione avatar (costo una tantum). courseId
    // null: è un'operazione a livello di tenant, non legata a un corso.
    await this.meter.record({
      tenantId,
      courseId: null,
      provider: 'HEYGEN',
      model: 'heygen-avatar-creation',
      unit: 'CALLS',
      quantity: 1,
      source: 'avatar_creation',
      region: 'global',
    });
    this.logger.log(`Avatar creato (tenant ${tenantId}): ${result.name} [${result.avatarId}] status=${result.status}`);
    // Invalida la cache "mine": il nuovo avatar deve comparire alla prossima lista.
    this.videoGen.invalidateMineCache?.();
    return result;
  }

  /**
   * Stato di un look avatar in creazione (polling dopo createAvatar): ritorna
   * 'processing' | 'completed' | 'failed', con preview ed engine supportati
   * quando pronto. Non consuma quota.
   */
  async getAvatarLook(lookId: string): Promise<AvatarLookStatus> {
    if (!this.videoGen || typeof this.videoGen.getAvatarLook !== 'function') {
      throw this.videoNotConfigured();
    }
    return this.videoGen.getAvatarLook(lookId);
  }

  /**
   * Elimina un avatar del tenant (gruppo + look su HeyGen). Non rimborsa il
   * costo di creazione (già sostenuto). Non tocca i corsi che lo referenziano:
   * i video già generati restano, ma l'avatar non è più selezionabile.
   */
  async deleteAvatar(_tenantId: string, groupId: string): Promise<{ deleted: true }> {
    if (!this.videoGen || typeof this.videoGen.deleteAvatar !== 'function') {
      throw this.videoNotConfigured();
    }
    try {
      await this.videoGen.deleteAvatar(groupId);
    } catch (err) {
      const detail = rawVideoGenError(err);
      this.logger.warn(`Eliminazione avatar fallita (${groupId}): ${detail}`);
      throw new BadRequestException(`Eliminazione avatar non riuscita: ${detail}`);
    }
    // Invalida la cache "mine": l'avatar eliminato non deve più comparire.
    this.videoGen.invalidateMineCache?.();
    return { deleted: true };
  }

  /**
   * Determina il TIPO di avatar ai fini del PREZZO di generazione video:
   *  - 'photo'  → avatar custom del tenant (creati da piattaforma): tariffa
   *               "Photo Avatar", più economica.
   *  - 'studio' → avatar STOCK del catalogo HeyGen: tariffa "Studio Avatar",
   *               più cara (soprattutto su Avatar IV).
   * Verifica se l'avatarId è tra quelli dell'account (lista 'mine', cache 1h
   * nell'adapter). Se non è determinabile (nessun avatar, provider senza lista)
   * assume 'studio' per prudenza (non sottostima mai il costo).
   */
  private async resolveAvatarBillingType(avatarId?: string): Promise<'photo' | 'studio'> {
    if (!avatarId || !this.videoGen) return 'studio';
    try {
      const mine = await this.videoGen.listAvatarsPage({ source: 'mine' });
      return mine.items.some((a) => a.id === avatarId) ? 'photo' : 'studio';
    } catch {
      // In caso di errore nel lookup, non sottostimare: usa la tariffa più alta.
      return 'studio';
    }
  }

  /**
   * Genera un video con avatar parlante per un singolo CONCETTO della lezione
   * (approccio manuale: l'autore sceglie quale concetto trasformare in video).
   *
   * Flusso: verifica la quota mensile del tenant (piano Free: 3 video/mese) →
   * individua/crea il block video_checkpoint target → costruisce un copione
   * breve (~1 min) dal testo del concetto / placeholderPrompt via LLM → avvia
   * il job HeyGen e persiste subito lo stato 'processing' con il jobRef nel
   * payload del block (così è ripristinabile dopo un riavvio) → fa polling in
   * background e, al termine, SCARICA l'MP4, lo salva su storage, imposta
   * storageKey/source nel MediaRef e avvia la trascrizione ASR. Idempotente
   * rispetto ai riavvii grazie a onModuleInit.
   *
   * Ritorna subito (202-style) con lo stato iniziale e la quota residua.
   */
  async generateConceptVideo(
    tenantId: string,
    courseId: string,
    lessonId: string,
    blockId: string,
    opts?: { avatarId?: string; voiceId?: string; script?: string },
  ): Promise<GenerateConceptVideoResult> {
    if (!this.videoGen) throw this.videoNotConfigured();
    const cfg = this.config.get('heygen', { infer: true });

    // TIPO di avatar (per prezzo e scelta engine): custom='photo', stock='studio'.
    // L'ENGINE non è scelto dall'utente: lo decide il server in base al tipo
    // (default economico Avatar III per i photo avatar). Un override via env
    // (HEYGEN_ENGINE) resta possibile per esigenze operative.
    const avatarType = await this.resolveAvatarBillingType(opts?.avatarId ?? cfg.defaultAvatarId);
    const engine = (cfg.engine || defaultEngineForAvatarType(avatarType)) as string;

    // Quota mensile per tenant: conta i video già generati nel mese solare
    // corrente (un UsageRecord VIDEOS per video). Blocca prima di chiamare
    // HeyGen, così non sprechiamo UX con un 4° tentativo destinato a fallire.
    const used = await this.countVideosThisMonth(tenantId);
    if (used >= cfg.monthlyQuota) {
      throw new BadRequestException(
        `Hai esaurito i ${cfg.monthlyQuota} video/mese del piano HeyGen. ` +
          'Attendi il mese prossimo oppure passa a un piano a pagamento.',
      );
    }

    const lesson = await this.requireLesson(tenantId, courseId, lessonId);
    const course = await this.prisma.course.findFirst({ where: { id: courseId, tenantId } });
    const blocks = Array.isArray(lesson.blocks) ? (lesson.blocks as unknown[]) : [];

    // Individua il block video_checkpoint target; se il block indicato è un
    // concetto testuale (rich_text), lo converte in un video_checkpoint che ne
    // conserva il testo come prima section ("Punti chiave").
    const vcBlock = this.ensureVideoCheckpointBlock(blocks, blockId);

    // Copione: usa quello fornito dall'autore, altrimenti sintetizza dal
    // contenuto del concetto (testo del block + placeholderPrompt del video).
    const script = (opts?.script?.trim())
      ? this.clampScript(opts.script.trim())
      : await this.buildVideoScript(vcBlock, course?.language ?? 'it', { tenantId, courseId });
    if (!script) {
      throw new BadRequestException(
        'Impossibile costruire un copione per il video: il concetto non ha testo. ' +
          'Aggiungi del contenuto al block oppure fornisci uno script.',
      );
    }

    // Avvia il job sul provider PRIMA di persistere, così salviamo il jobRef.
    let jobRef: string;
    try {
      const started = await this.videoGen.startJob({
        script,
        avatarId: opts?.avatarId ?? cfg.defaultAvatarId,
        voiceId: opts?.voiceId ?? cfg.defaultVoiceId,
        resolution: cfg.resolution,
        language: course?.language,
        // Engine scelto per questa generazione (non più fisso in config).
        engine,
        // Chiediamo i sottotitoli: ne ricaviamo la trascrizione karaoke gratis
        // (già sincronizzata col parlato), evitando un ASR esterno a pagamento.
        caption: true,
      });
      jobRef = started.jobRef;
    } catch (err) {
      const detail = rawVideoGenError(err);
      this.logger.warn(`Avvio generazione video fallito (lezione ${lessonId}): ${detail}`);
      throw new BadRequestException(`Generazione video non avviata: ${detail}`);
    }

    // Persiste lo stato 'processing' + jobRef nel payload del block. Il video
    // resta un placeholder (nessuno storageKey) finché il rendering non finisce.
    // Trasformare un concetto in video rende la lezione VIDEO-FIRST: il video
    // diventa il fulcro, con gli altri elementi affiancati (requisito prodotto).
    const payload = (vcBlock.payload ?? {}) as Record<string, unknown>;
    payload.videoGenStatus = 'processing';
    payload.videoGenJobRef = jobRef;
    payload.videoGenAvatarType = avatarType;
    // Persiste anche l'engine scelto: il metering a fine rendering (background,
    // resiliente ai riavvii) applica la tariffa per-engine corretta.
    payload.videoGenEngine = engine;
    delete payload.videoGenError;
    vcBlock.payload = payload;
    await this.prisma.lesson.update({
      where: { id: lessonId },
      data: { blocks: blocks as object, videoFirst: true, updatedAt: new Date() },
    });

    // Polling in BACKGROUND: non blocca la risposta.
    const ctx = { tenantId, courseId, lessonId, blockId: vcBlock.id as string };
    void this.pollVideoGenJob(ctx, jobRef, course?.language ?? undefined);

    return {
      status: 'processing',
      blockId: vcBlock.id as string,
      jobRef,
      remainingThisMonth: Math.max(0, cfg.monthlyQuota - used - 1),
    };
  }

  /**
   * (Ri)avvia la trascrizione automatica (ASR) del video già presente nel block
   * video_checkpoint indicato, SENZA rigenerare il video. Utile quando l'ASR
   * iniziale è fallita (es. locale lingua non valido) o per rigenerare la
   * trascrizione. Richiede che il video abbia uno storageKey (file su storage,
   * non un embed esterno) e un provider ASR asincrono configurato.
   */
  async retranscribeLessonVideo(
    tenantId: string,
    courseId: string,
    lessonId: string,
    blockId: string,
  ): Promise<{ status: 'processing' }> {
    if (typeof this.transcription.startJob !== 'function') {
      throw new NotImplementedException(
        'Trascrizione automatica non configurata (imposta PROVIDER_TRANSCRIPTION=transcribe).',
      );
    }
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, tenantId },
      select: { language: true },
    });
    const lesson = await this.requireLesson(tenantId, courseId, lessonId);
    const blocks = Array.isArray(lesson.blocks) ? (lesson.blocks as unknown[]) : [];
    const vcBlock = this.findVideoCheckpointBlock(blocks, blockId);
    if (!vcBlock) throw new NotFoundException('Block video non trovato nella lezione');
    const payload = (vcBlock.payload ?? {}) as Record<string, unknown>;
    const video = (payload.video ?? {}) as { storageKey?: string; source?: string };
    if (!video.storageKey) {
      throw new BadRequestException(
        'Nessun file video da trascrivere: il video è un embed esterno o non è ancora stato caricato.',
      );
    }

    const asrLanguage = asrLocale(course?.language);
    let jobRef: string;
    try {
      const started = await this.transcription.startJob({
        storageKey: video.storageKey,
        contentType: 'video/mp4',
        language: asrLanguage,
      });
      jobRef = started.jobRef;
    } catch (err) {
      const reason = describeTranscriptionError(err);
      this.logger.warn(`Riavvio trascrizione fallito (lezione ${lessonId}): ${rawTranscriptionError(err)}`);
      await this.writeTranscript(tenantId, courseId, lessonId, vcBlock.id as string, [], 'failed', reason).catch(
        () => undefined,
      );
      throw new BadRequestException(`Trascrizione non avviata: ${reason}`);
    }

    payload.transcriptStatus = 'processing';
    payload.transcriptJobRef = jobRef;
    delete payload.transcriptError;
    vcBlock.payload = payload;
    await this.prisma.lesson.update({
      where: { id: lessonId },
      data: { blocks: blocks as object, updatedAt: new Date() },
    });

    const ctx = { tenantId, courseId, lessonId, blockId: vcBlock.id as string };
    void this.pollTranscriptionJob(ctx, jobRef);
    return { status: 'processing' };
  }

  /**
   * Conta i video HeyGen generati dal tenant nel mese solare corrente. Conta i
   * record di consumo HEYGEN con source 'concept_video' (un record = un video),
   * indipendentemente dall'unità (SECONDS): così la quota resta valida anche
   * dopo il passaggio del metering da VIDEOS a SECONDS.
   */
  private async countVideosThisMonth(tenantId: string): Promise<number> {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return this.prisma.usageRecord.count({
      where: {
        tenantId,
        provider: 'HEYGEN',
        source: 'concept_video',
        createdAt: { gte: monthStart },
      },
    });
  }

  /** NotImplemented coerente con lo stock image provider (risposta 501). */
  private videoNotConfigured(): NotImplementedException {
    return new NotImplementedException(
      'Generazione video non configurata (imposta PROVIDER_VIDEO=heygen e HEYGEN_API_KEY)',
    );
  }

  /**
   * Restituisce il block video_checkpoint target. Se `blockId` punta a un
   * concetto rich_text, lo CONVERTE in un video_checkpoint mantenendo il testo
   * del concetto come prima section (così il contenuto non va perso e resta
   * affiancato al video). Se esiste già un video_checkpoint lo riusa.
   */
  private ensureVideoCheckpointBlock(
    blocks: unknown[],
    blockId: string,
  ): { id?: unknown; type?: string; payload?: unknown } {
    const list = blocks as Array<{ id?: unknown; type?: string; payload?: unknown; editorial?: unknown }>;
    const idx = list.findIndex((b) => b.id === blockId);
    const target = idx >= 0 ? list[idx] : undefined;

    // Già un video_checkpoint: riusa.
    if (target && target.type === 'video_checkpoint') return target;

    // Concetto rich_text: converti in video_checkpoint preservando il testo.
    if (target && target.type === 'rich_text') {
      const rtPayload = (target.payload ?? {}) as { content?: { html?: string } };
      const html = rtPayload.content?.html ?? '';
      const converted = {
        id: target.id,
        type: 'video_checkpoint',
        editorial: target.editorial ?? {},
        payload: {
          video: { kind: 'video', alt: '', source: 'upload' },
          checkpoints: [],
          transcript: [],
          transcriptStatus: 'none',
          sections: html
            ? [{ id: `${String(target.id)}-sec`, title: 'Punti chiave', content: { format: 'html', html } }]
            : [],
        } as Record<string, unknown>,
      };
      list[idx] = converted;
      return converted;
    }

    // Fallback: primo video_checkpoint esistente nella lezione.
    const existing = list.find((b) => b.type === 'video_checkpoint');
    if (existing) return existing;

    throw new NotFoundException(
      'Nessun block video_checkpoint o concetto testuale trovato per questo id',
    );
  }

  /**
   * Costruisce un copione parlato BREVE (max ~1 min) per l'avatar, a partire dal
   * testo del concetto (sections/rich_text del block) e dal placeholderPrompt
   * del video. Usa l'LLM per produrre un parlato naturale in prima persona nella
   * lingua del corso; in caso di errore ripiega sul testo grezzo troncato.
   */
  private async buildVideoScript(
    vcBlock: { payload?: unknown },
    language: string,
    meterCtx: MeterCtx,
  ): Promise<string> {
    const payload = (vcBlock.payload ?? {}) as {
      video?: { placeholderPrompt?: string; alt?: string };
      sections?: Array<{ content?: { html?: string } }>;
    };
    const sectionsText = (payload.sections ?? [])
      .map((s) => htmlToText(s.content?.html ?? ''))
      .filter(Boolean)
      .join('\n');
    const hint = payload.video?.placeholderPrompt || payload.video?.alt || '';
    const sourceText = [hint, sectionsText].filter(Boolean).join('\n').trim();
    if (!sourceText) return '';

    try {
      const result = await this.llm.generate({
        system:
          'Sei uno sceneggiatore di micro-video didattici. Scrivi un copione PARLATO, ' +
          'naturale e diretto, che un avatar pronuncerà. Vincoli: UNA SOLA voce narrante, ' +
          'nessuna indicazione di scena, nessun markdown, nessun elenco puntato, solo frasi ' +
          `da leggere ad alta voce. Lingua: ${language}. Durata target: 45-60 secondi ` +
          `(massimo ${VIDEO_SCRIPT_MAX_WORDS} parole). Restituisci SOLO il copione.`,
        messages: [{ role: 'user', content: `Concetto da spiegare nel video:\n${sourceText}` }],
        temperature: 0.5,
        maxTokens: 500,
      });
      await this.meter.record({
        ...meterCtx,
        provider: 'BEDROCK_LLM',
        model: result.model,
        unit: 'INPUT_TOKENS',
        quantity: result.usage.inputTokens,
        source: 'video_script',
      });
      await this.meter.record({
        ...meterCtx,
        provider: 'BEDROCK_LLM',
        model: result.model,
        unit: 'OUTPUT_TOKENS',
        quantity: result.usage.outputTokens,
        source: 'video_script',
      });
      const script = result.text.trim();
      return this.clampScript(script.length > 0 ? script : sourceText);
    } catch (err) {
      this.logger.warn(`Copione video via LLM non riuscito, uso il testo grezzo: ${err instanceof Error ? err.message : 'errore'}`);
      return this.clampScript(sourceText);
    }
  }

  /** Tronca il copione a VIDEO_SCRIPT_MAX_WORDS parole (vincolo durata Free). */
  private clampScript(text: string): string {
    const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (words.length <= VIDEO_SCRIPT_MAX_WORDS) return words.join(' ');
    return words.slice(0, VIDEO_SCRIPT_MAX_WORDS).join(' ');
  }

  /**
   * Esegue il polling di un job di generazione video già avviato e, al termine,
   * scarica l'MP4, lo salva su storage e aggiorna il block. Resiliente a un
   * riavvio del processo (fetchJob interroga il provider per jobRef). Best-effort.
   */
  private async pollVideoGenJob(
    ctx: { tenantId: string; courseId: string; lessonId: string; blockId: string },
    jobRef: string,
    language?: string,
  ): Promise<void> {
    if (!this.videoGen) return;
    const deadline = Date.now() + VIDEOGEN_POLL_TIMEOUT_MS;
    try {
      for (;;) {
        if (Date.now() > deadline) {
          await this.writeVideoGenError(
            ctx,
            'La generazione del video ha impiegato troppo tempo. Riprova più tardi.',
          ).catch(() => undefined);
          return;
        }
        await sleep(VIDEOGEN_POLL_INTERVAL_MS);
        const r = await this.videoGen.fetchJob(jobRef);
        if (r.status === 'processing') continue;
        if (r.status === 'failed') {
          this.logger.warn(`Generazione video fallita (lezione ${ctx.lessonId}): ${r.reason}`);
          await this.writeVideoGenError(ctx, describeVideoGenError(r.reason)).catch(() => undefined);
          return;
        }
        await this.applyVideoGenResult(ctx, r.videoUrl, r.durationSec, language, r.subtitleUrl);
        return;
      }
    } catch (err) {
      this.logger.warn(`Polling video fallito (lezione ${ctx.lessonId}): ${rawVideoGenError(err)}`);
      await this.writeVideoGenError(ctx, describeVideoGenError(rawVideoGenError(err))).catch(() => undefined);
    }
  }

  /**
   * Scarica il video renderizzato (da URL presigned o data: URL del mock), lo
   * salva su storage, imposta storageKey/source nel MediaRef del block, azzera
   * lo stato di generazione, registra il metering (1 VIDEOS) e avvia l'ASR.
   */
  private async applyVideoGenResult(
    ctx: { tenantId: string; courseId: string; lessonId: string; blockId: string },
    videoUrl: string,
    durationSec: number | undefined,
    language?: string,
    subtitleUrl?: string,
  ): Promise<void> {
    const { bytes, contentType } = await downloadVideo(videoUrl);
    const key = `media/${ctx.tenantId}/${ctx.courseId}/video/${randomUUID()}.mp4`;
    await this.storage.putObject(key, Buffer.from(bytes), { contentType });

    // Prova a ricavare la trascrizione dai SOTTOTITOLI nativi del provider
    // (gratis, già sincronizzati col parlato). Se presenti, NIENTE ASR esterno.
    let subtitleCues: Array<{ id: string; start: number; end: number; text: string }> = [];
    if (subtitleUrl) {
      try {
        const srt = await downloadText(subtitleUrl);
        subtitleCues = parseSrtToCues(srt);
      } catch (err) {
        this.logger.warn(
          `Download/parse sottotitoli HeyGen fallito (lezione ${ctx.lessonId}): ${err instanceof Error ? err.message : 'errore'}`,
        );
      }
    }
    const hasSubtitles = subtitleCues.length > 0;

    const lesson = await this.requireLesson(ctx.tenantId, ctx.courseId, ctx.lessonId);
    const blocks = Array.isArray(lesson.blocks) ? (lesson.blocks as unknown[]) : [];
    const ref = this.findVideoRef(blocks, ctx.blockId);
    const vcBlock = this.findVideoCheckpointBlock(blocks, ctx.blockId);
    if (ref) {
      ref.storageKey = key;
      ref.source = 'upload';
    }
    // Tipo di avatar e engine persistiti all'avvio (per la tariffa): avatarType
    // 'photo'=custom | 'studio'=stock; engine scelto dall'autore. Default
    // prudenziali (studio = tariffa più alta; engine da config/default).
    let avatarType: 'photo' | 'studio' = 'studio';
    let engine = (this.config.get('heygen', { infer: true }).engine || DEFAULT_HEYGEN_ENGINE).toLowerCase();
    if (vcBlock) {
      const payload = (vcBlock.payload ?? {}) as Record<string, unknown>;
      if (payload.videoGenAvatarType === 'photo') avatarType = 'photo';
      if (typeof payload.videoGenEngine === 'string' && payload.videoGenEngine) {
        engine = payload.videoGenEngine.toLowerCase();
      }
      payload.videoGenStatus = 'ready';
      delete payload.videoGenError;
      delete payload.videoGenJobRef;
      delete payload.videoGenAvatarType;
      delete payload.videoGenEngine;
      if (hasSubtitles) {
        // Trascrizione pronta dai sottotitoli del provider.
        payload.transcript = subtitleCues;
        payload.transcriptStatus = 'ready';
        delete payload.transcriptError;
        delete payload.transcriptJobRef;
      } else {
        // Nessun sottotitolo: ricadremo sull'ASR (sotto).
        payload.transcriptStatus = 'processing';
      }
      vcBlock.payload = payload;
    }
    await this.prisma.lesson.update({
      where: { id: ctx.lessonId },
      data: { blocks: blocks as object, updatedAt: new Date() },
    });

    // Metering: HeyGen fattura per MINUTO/SECONDO di video, con prezzo diverso
    // per ENGINE **e** per TIPO di avatar. A parità di engine un avatar "photo"
    // custom costa meno di uno "studio" stock (es. Avatar IV: $2.31 vs $4.83/min).
    // Prezzi self-serve (per minuto): III photo/studio $0.99; IV photo $2.31,
    // IV studio $4.83; V $7.20. Registriamo i SECONDI con
    // model = heygen-<engine>-<tipo>, così il listino applica la tariffa giusta.
    // `engine` e `avatarType` sono quelli scelti all'avvio (letti dal payload).
    const seconds = Math.max(1, Math.ceil(durationSec ?? 0));
    await this.meter.record({
      tenantId: ctx.tenantId,
      courseId: ctx.courseId,
      provider: 'HEYGEN',
      model: `heygen-${engine}-${avatarType}`,
      unit: 'SECONDS',
      quantity: seconds,
      source: 'concept_video',
      region: 'global',
    });

    this.logger.log(
      `Video avatar generato (lezione ${ctx.lessonId}, ${durationSec ?? '?'}s): ${key}` +
        (hasSubtitles ? ` — trascrizione dai sottotitoli HeyGen (${subtitleCues.length} cue)` : ''),
    );

    // Se abbiamo già la trascrizione dai sottotitoli del provider, abbiamo
    // finito: niente ASR esterno (nessun costo, già sincronizzata).
    if (hasSubtitles) return;

    // Fallback: nessun sottotitolo dal provider → trascrizione automatica ASR
    // del video generato (come per gli upload manuali).
    if (vcBlock) {
      if (typeof this.transcription.startJob === 'function') {
        try {
          // Amazon Transcribe richiede il LOCALE completo (es. "it-IT"), non il
          // codice corto ("it"): mappalo, altrimenti il job è rifiutato con un
          // errore di validazione sull'enum languageCode.
          const asrLanguage = asrLocale(language);
          const started = await this.transcription.startJob({ storageKey: key, contentType: 'video/mp4', language: asrLanguage });
          const payload = (vcBlock.payload ?? {}) as Record<string, unknown>;
          payload.transcriptJobRef = started.jobRef;
          vcBlock.payload = payload;
          await this.prisma.lesson.update({
            where: { id: ctx.lessonId },
            data: { blocks: blocks as object, updatedAt: new Date() },
          });
          void this.pollTranscriptionJob(ctx, started.jobRef);
        } catch (err) {
          this.logger.warn(`Avvio trascrizione video generato fallito (lezione ${ctx.lessonId}): ${rawTranscriptionError(err)}`);
          await this.writeTranscript(ctx.tenantId, ctx.courseId, ctx.lessonId, ctx.blockId, [], 'none').catch(() => undefined);
        }
      } else {
        void this.transcribeVideoInBackground(ctx, key, 'video/mp4');
      }
    }
  }

  /** Scrive lo stato di errore della generazione video nel payload del block. */
  private async writeVideoGenError(
    ctx: { tenantId: string; courseId: string; lessonId: string; blockId: string },
    reason: string,
  ): Promise<void> {
    const lesson = await this.requireLesson(ctx.tenantId, ctx.courseId, ctx.lessonId);
    const blocks = Array.isArray(lesson.blocks) ? (lesson.blocks as unknown[]) : [];
    const vcBlock = this.findVideoCheckpointBlock(blocks, ctx.blockId);
    if (!vcBlock) return;
    const payload = (vcBlock.payload ?? {}) as Record<string, unknown>;
    payload.videoGenStatus = 'failed';
    payload.videoGenError = reason;
    delete payload.videoGenJobRef;
    vcBlock.payload = payload;
    await this.prisma.lesson.update({
      where: { id: ctx.lessonId },
      data: { blocks: blocks as object, updatedAt: new Date() },
    });
  }

  /**
   * Al boot riprende i job di generazione video lasciati in sospeso da un
   * riavvio: block con videoGenStatus='processing' e un videoGenJobRef. Senza
   * questo, un riavvio durante il rendering lascerebbe lo stato 'processing'
   * per sempre. Best-effort e non bloccante.
   */
  private async findPendingVideoGenJobs(): Promise<
    Array<{ tenantId: string; courseId: string; lessonId: string; blockId: string; jobRef: string }>
  > {
    const lessons = await this.prisma.lesson.findMany({
      select: { id: true, blocks: true, module: { select: { course: { select: { id: true, tenantId: true } } } } },
    });
    const out: Array<{ tenantId: string; courseId: string; lessonId: string; blockId: string; jobRef: string }> = [];
    for (const lesson of lessons) {
      const blocks = Array.isArray(lesson.blocks) ? (lesson.blocks as Array<Record<string, unknown>>) : [];
      for (const b of blocks) {
        if (b?.type !== 'video_checkpoint') continue;
        const payload = (b.payload ?? {}) as Record<string, unknown>;
        if (payload.videoGenStatus !== 'processing') continue;
        const jobRef = payload.videoGenJobRef;
        if (typeof jobRef !== 'string' || !jobRef) continue;
        out.push({
          tenantId: lesson.module.course.tenantId,
          courseId: lesson.module.course.id,
          lessonId: lesson.id,
          blockId: b.id as string,
          jobRef,
        });
      }
    }
    return out;
  }

  /** Trova il block video_checkpoint per id (fallback: primo video_checkpoint). */
  private findVideoCheckpointBlock(
    blocks: unknown[],
    blockId: string,
  ): { id?: unknown; type?: string; payload?: unknown } | null {
    const list = blocks as Array<{ id?: unknown; type?: string; payload?: unknown }>;
    const byId = list.find((b) => b.id === blockId && b.type === 'video_checkpoint');
    if (byId) return byId;
    return list.find((b) => b.type === 'video_checkpoint') ?? null;
  }

  /**
   * Collega un VideoAsset della libreria al block video_checkpoint indicato:
   * copia source/storageKey/externalUrl/externalId e la trascrizione già pronta
   * nel payload del block. Niente upload né ri-trascrizione (il video è già
   * nella libreria). Ritorna la lezione aggiornata.
   */
  async attachVideoAssetToBlock(
    tenantId: string,
    courseId: string,
    lessonId: string,
    blockId: string,
    videoAssetId: string,
  ): Promise<{ attached: true }> {
    const asset = await this.prisma.videoAsset.findFirst({ where: { id: videoAssetId, tenantId } });
    if (!asset) throw new NotFoundException('Video non trovato in libreria');

    const lesson = await this.requireLesson(tenantId, courseId, lessonId);
    const blocks = Array.isArray(lesson.blocks) ? (lesson.blocks as unknown[]) : [];
    const ref = this.findVideoRef(blocks, blockId);
    if (!ref) throw new NotFoundException('Nessun segnaposto video trovato nella lezione per questo block');

    const source = asset.source.toLowerCase() as MediaRefLike['source'];
    // Pulisce i campi del MediaRef e imposta quelli coerenti con la sorgente.
    ref.source = source;
    if (asset.source === 'UPLOAD') {
      ref.storageKey = asset.storageKey ?? undefined;
      ref.externalUrl = undefined;
      ref.externalId = undefined;
    } else {
      ref.storageKey = undefined;
      ref.externalUrl = asset.externalUrl ?? undefined;
      ref.externalId = asset.externalId ?? undefined;
    }

    // Trascrizione e stato dal VideoAsset nel payload del block.
    const vcBlock = this.findVideoCheckpointBlock(blocks, blockId);
    if (vcBlock) {
      const payload = (vcBlock.payload ?? {}) as Record<string, unknown>;
      const transcript = Array.isArray(asset.transcript) ? asset.transcript : [];
      payload.transcript = transcript;
      payload.transcriptStatus = asset.transcriptStatus.toLowerCase();
      vcBlock.payload = payload;
    }

    await this.prisma.lesson.update({
      where: { id: lessonId },
      data: { blocks: blocks as object, updatedAt: new Date() },
    });
    return { attached: true };
  }

  /** Trova il MediaRef video (kind 'video') nel block con id dato. */
  private findVideoRef(blocks: unknown[], blockId: string): MediaRefLike | null {
    let found: MediaRefLike | null = null;
    const visitForVideo = (node: unknown): void => {
      if (found) return;
      if (Array.isArray(node)) {
        node.forEach(visitForVideo);
        return;
      }
      if (node === null || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (obj.kind === 'video') {
        found = obj as MediaRefLike;
        return;
      }
      for (const value of Object.values(obj)) visitForVideo(value);
    };
    // Cerca prima nel block specifico, poi in tutta la lezione come fallback.
    const target = blocks.find((b) => (b as { id?: string }).id === blockId);
    if (target) visitForVideo(target);
    if (!found) visitForVideo(blocks);
    return found;
  }

  /** Raccoglie (per riferimento) tutti i MediaRef immagine annidati nei block. */
  private collectImageRefs(blocks: unknown[]): MediaRefLike[] {
    const refs: MediaRefLike[] = [];
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (node === null || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      // Un MediaRef immagine ha kind 'image' (eventualmente senza storageKey).
      if (obj.kind === 'image') refs.push(obj as MediaRefLike);
      for (const value of Object.values(obj)) visit(value);
    };
    visit(blocks);
    return refs;
  }

  /** Concatena il testo leggibile dei block rich_text (HTML -> testo piano). */
  private extractNarrationText(blocks: unknown[]): string {
    const parts: string[] = [];
    for (const b of blocks) {
      const block = b as { type?: string; payload?: { content?: { html?: string } } };
      if (block.type === 'rich_text' && block.payload?.content?.html) {
        parts.push(htmlToText(block.payload.content.html));
      }
    }
    return parts.join('\n\n').trim();
  }

  // --- Cartoon delle scene "pillole" (Nova Reel) ----------------------------

  /** NotImplemented coerente con gli altri provider opzionali (risposta 501). */
  private cartoonNotConfigured(): NotImplementedException {
    return new NotImplementedException(
      'Generazione cartoon non configurata (imposta PROVIDER_CARTOON_VIDEO=nova e NOVA_REEL_OUTPUT_S3_URI)',
    );
  }

  /** Scene-cartoon generate dal tenant nel mese solare corrente (per la quota). */
  private async countCartoonsThisMonth(tenantId: string): Promise<number> {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return this.prisma.usageRecord.count({
      where: { tenantId, provider: 'BEDROCK_VIDEO', source: 'scene_cartoon', createdAt: { gte: monthStart } },
    });
  }

  /**
   * Avvia la generazione del cartoon per UNA scena di una lezione, o per TUTTE
   * le scene con un video segnaposto se `sceneId` è assente. Le scene sono
   * raccolte in modo agnostico al tipo di block (branching_scenario → una per
   * node; video_checkpoint → una per block). Per ogni scena usa lo storyboard
   * (placeholderPrompt) come prompt text-to-video, la segna 'processing' e fa
   * polling in background. Ritorna quante scene sono state avviate.
   */
  async generateScenesCartoon(
    tenantId: string,
    courseId: string,
    lessonId: string,
    blockId: string,
    sceneId?: string,
  ): Promise<{ started: number; remainingThisMonth: number }> {
    if (!this.cartoonGen) throw this.cartoonNotConfigured();
    const cfg = this.config.get('cartoonVideo', { infer: true });
    const course = await this.prisma.course.findFirst({ where: { id: courseId, tenantId }, select: { language: true } });
    const lesson = await this.requireLesson(tenantId, courseId, lessonId);
    const blocks = Array.isArray(lesson.blocks) ? (lesson.blocks as unknown[]) : [];

    // Scene cartoon della lezione (riferimenti vivi al MediaRef), da qualunque
    // tipo di block: branching_scenario (una per node) e video_checkpoint (una
    // per block). Se blockId/sceneId sono dati, limita l'ambito.
    const allScenes = collectCartoonScenes(blocks, blockId, sceneId);

    // Scene candidate: media VIDEO ancora SENZA file (placeholder) e non già in
    // elaborazione con un job attivo. Una scena 'processing' SENZA jobRef è
    // rimasta bloccata (es. riavvio durante l'avvio) e va ripresa.
    const candidates = allScenes.filter((s) => {
      const m = s.media;
      if (!isPlaceholderVideo(m)) return false;
      if (m.videoGenStatus === 'processing' && typeof m.videoGenJobRef === 'string' && m.videoGenJobRef) {
        return false;
      }
      return true;
    });
    if (candidates.length === 0) {
      throw new BadRequestException(
        sceneId
          ? 'La scena indicata non ha un video da generare (già presente o non è un video).'
          : 'Nessuna scena con video da generare in questa pillola.',
      );
    }

    // Quota mensile per tenant.
    const used = await this.countCartoonsThisMonth(tenantId);
    const room = Math.max(0, cfg.monthlyQuota - used);
    if (room === 0) {
      throw new BadRequestException(
        `Hai esaurito i ${cfg.monthlyQuota} cartoon/mese. Attendi il mese prossimo o alza CARTOON_VIDEO_MONTHLY_QUOTA.`,
      );
    }
    const toStart = candidates
      .slice(0, room)
      .map((s) => ({ blockId: s.blockId, sceneId: s.sceneId, prompt: s.prompt }))
      .filter((s) => s.prompt.length > 0);

    if (toStart.length === 0) {
      throw new BadRequestException('Nessun cartoon avviato (storyboard mancante in tutte le scene).');
    }

    // Marca subito TUTTE le scene candidate come 'processing' e persiste, così
    // la UI mostra l'avanzamento anche prima che i singoli job partano (gli
    // avvii avvengono uno alla volta in background, con retry).
    for (const s of toStart) {
      const scene = candidates.find((c) => c.blockId === s.blockId && c.sceneId === s.sceneId);
      if (!scene) continue;
      scene.media.videoGenStatus = 'processing';
      delete scene.media.videoGenError;
      delete scene.media.videoGenJobRef;
    }
    await this.prisma.lesson.update({
      where: { id: lessonId },
      data: { blocks: blocks as object, updatedAt: new Date() },
    });

    // Lavorazione SEQUENZIALE in background: per ogni scena avvia il job (con
    // retry/backoff sugli errori transitori: sottoscrizione Marketplace in
    // attivazione, throttling) e poi fa il polling fino al risultato. Elaborare
    // UNA scena alla volta evita sia la race (lost update) sul JSON condiviso
    // lesson.blocks, sia la raffica di StartAsyncInvoke che scatena il throttling.
    void this.processScenesCartoonSequential(
      {
        tenantId,
        courseId,
        lessonId,
        language: course?.language ?? undefined,
        durationSec: cfg.sceneDurationSec,
      },
      toStart,
    );

    return { started: toStart.length, remainingThisMonth: Math.max(0, room - toStart.length) };
  }

  /**
   * Per ogni scena: avvia il job cartoon (con retry sugli errori transitori) e
   * ne attende il risultato, UNA scena alla volta. La prima scena "scalda" la
   * sottoscrizione Marketplace del provider, così le successive non incappano
   * nell'errore di attivazione.
   */
  private async processScenesCartoonSequential(
    base: {
      tenantId: string;
      courseId: string;
      lessonId: string;
      language?: string;
      durationSec: number;
    },
    scenes: Array<{ blockId: string; sceneId: string; prompt: string }>,
  ): Promise<void> {
    if (!this.cartoonGen) return;
    for (const s of scenes) {
      const ctx = { ...base, blockId: s.blockId, sceneId: s.sceneId };
      const jobRef = await this.startCartoonJobWithRetry(s.prompt, base).catch((err) => {
        this.logger.warn(`Avvio cartoon scena ${s.sceneId} fallito: ${rawVideoGenError(err)}`);
        return null;
      });
      if (!jobRef) {
        await this.writeCartoonError(ctx, 'Avvio della generazione non riuscito dopo più tentativi.').catch(
          () => undefined,
        );
        continue;
      }
      await this.setCartoonJobRef(ctx, jobRef).catch(() => undefined);
      await this.pollCartoonJob(ctx, jobRef);
    }
  }

  /**
   * Avvia un job cartoon ritentando con backoff gli errori TRANSITORI (prima
   * sottoscrizione Marketplace in attivazione, throttling). Rilancia subito gli
   * errori non transitori. Ritorna il jobRef o lancia all'ultimo tentativo.
   */
  private async startCartoonJobWithRetry(
    prompt: string,
    opts: { language?: string; durationSec: number },
  ): Promise<string> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < CARTOON_START_MAX_ATTEMPTS; attempt++) {
      try {
        const { jobRef } = await this.cartoonGen!.startJob({
          prompt,
          durationSec: opts.durationSec,
          language: opts.language,
          aspectRatio: '16:9',
        });
        return jobRef;
      } catch (err) {
        lastErr = err;
        if (!isTransientCartoonError(err) || attempt === CARTOON_START_MAX_ATTEMPTS - 1) throw err;
        const wait = CARTOON_START_BACKOFF_MS[Math.min(attempt, CARTOON_START_BACKOFF_MS.length - 1)]!;
        this.logger.log(
          `Avvio cartoon transitorio (tentativo ${attempt + 1}/${CARTOON_START_MAX_ATTEMPTS}), ` +
            `riprovo tra ${Math.round(wait / 1000)}s: ${rawVideoGenError(err)}`,
        );
        await sleep(wait);
      }
    }
    throw lastErr;
  }

  /** Persiste il jobRef sulla scena (per ripristino dopo riavvio) + processing. */
  private async setCartoonJobRef(
    ctx: { tenantId: string; courseId: string; lessonId: string; blockId: string; sceneId: string },
    jobRef: string,
  ): Promise<void> {
    const lesson = await this.requireLesson(ctx.tenantId, ctx.courseId, ctx.lessonId);
    const blocks = Array.isArray(lesson.blocks) ? (lesson.blocks as unknown[]) : [];
    const scene = findCartoonScene(blocks, ctx.blockId, ctx.sceneId);
    if (!scene) return;
    scene.media.videoGenStatus = 'processing';
    scene.media.videoGenJobRef = jobRef;
    delete scene.media.videoGenError;
    await this.prisma.lesson.update({
      where: { id: ctx.lessonId },
      data: { blocks: blocks as object, updatedAt: new Date() },
    });
  }

  /** Polling in background di un job cartoon per una scena. */
  private async pollCartoonJob(
    ctx: { tenantId: string; courseId: string; lessonId: string; blockId: string; sceneId: string },
    jobRef: string,
  ): Promise<void> {
    if (!this.cartoonGen) return;
    const deadline = Date.now() + VIDEOGEN_POLL_TIMEOUT_MS;
    try {
      for (;;) {
        if (Date.now() > deadline) {
          await this.writeCartoonError(ctx, 'La generazione del cartoon ha impiegato troppo tempo.').catch(() => undefined);
          return;
        }
        await sleep(VIDEOGEN_POLL_INTERVAL_MS);
        const r = await this.cartoonGen.fetchJob(jobRef);
        if (r.status === 'processing') continue;
        if (r.status === 'failed') {
          this.logger.warn(`Cartoon scena ${ctx.sceneId} fallito: ${r.reason}`);
          await this.writeCartoonError(ctx, r.reason).catch(() => undefined);
          return;
        }
        await this.applyCartoonResult(ctx, r.bytes, r.contentType, r.durationSec);
        return;
      }
    } catch (err) {
      this.logger.warn(`Polling cartoon scena ${ctx.sceneId} fallito: ${rawVideoGenError(err)}`);
      await this.writeCartoonError(ctx, rawVideoGenError(err)).catch(() => undefined);
    }
  }

  /**
   * Salva i byte del cartoon (consegnati dall'adapter) sotto la key canonica
   * dei media, imposta storageKey nel media della scena, azzera lo stato e
   * registra il metering (SECONDS).
   */
  private async applyCartoonResult(
    ctx: { tenantId: string; courseId: string; lessonId: string; blockId: string; sceneId: string },
    bytes: Uint8Array,
    contentType: string | undefined,
    durationSec: number | undefined,
  ): Promise<void> {
    const key = `media/${ctx.tenantId}/${ctx.courseId}/video/${randomUUID()}.mp4`;
    await this.storage.putObject(key, Buffer.from(bytes), { contentType: contentType ?? 'video/mp4' });

    const lesson = await this.requireLesson(ctx.tenantId, ctx.courseId, ctx.lessonId);
    const blocks = Array.isArray(lesson.blocks) ? (lesson.blocks as unknown[]) : [];
    const scene = findCartoonScene(blocks, ctx.blockId, ctx.sceneId);
    if (scene) {
      scene.media.storageKey = key;
      scene.media.source = 'upload';
      scene.media.videoGenStatus = 'ready';
      delete scene.media.videoGenJobRef;
      delete scene.media.videoGenError;
      await this.prisma.lesson.update({
        where: { id: ctx.lessonId },
        data: { blocks: blocks as object, updatedAt: new Date() },
      });
    }

    const cfg = this.config.get('cartoonVideo', { infer: true });
    const seconds = Math.max(1, Math.ceil(durationSec ?? cfg.sceneDurationSec));
    // Il modello del listino dipende dal provider: 'remotion' è code-to-video
    // (costo ~CPU/TTS, listino 'remotion-code-to-video'), luma/nova sono modelli
    // neurali ($/s). Listino region-agnostico (seed 'global') per evitare
    // mismatch con la region Bedrock effettiva.
    const meterModel = cfg.provider === 'remotion' ? 'remotion-code-to-video' : cfg.modelId;
    await this.meter.record({
      tenantId: ctx.tenantId,
      courseId: ctx.courseId,
      provider: 'BEDROCK_VIDEO',
      model: meterModel,
      unit: 'SECONDS',
      quantity: seconds,
      source: 'scene_cartoon',
      region: 'global',
    });
    this.logger.log(`Cartoon scena ${ctx.sceneId} pronto (${seconds}s, ${cfg.provider}): ${key}`);
  }

  /** Scrive lo stato di errore della generazione cartoon nel media della scena. */
  private async writeCartoonError(
    ctx: { tenantId: string; courseId: string; lessonId: string; blockId: string; sceneId: string },
    reason: string,
  ): Promise<void> {
    const lesson = await this.requireLesson(ctx.tenantId, ctx.courseId, ctx.lessonId);
    const blocks = Array.isArray(lesson.blocks) ? (lesson.blocks as unknown[]) : [];
    const scene = findCartoonScene(blocks, ctx.blockId, ctx.sceneId);
    if (!scene) return;
    scene.media.videoGenStatus = 'failed';
    scene.media.videoGenError = reason;
    delete scene.media.videoGenJobRef;
    await this.prisma.lesson.update({
      where: { id: ctx.lessonId },
      data: { blocks: blocks as object, updatedAt: new Date() },
    });
  }

  private async requireLesson(tenantId: string, courseId: string, lessonId: string) {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, module: { course: { id: courseId, tenantId } } },
    });
    if (!lesson) throw new NotFoundException('Lezione non trovata');
    return lesson;
  }

  /**
   * Trova i block video con una trascrizione ancora in corso (status
   * 'processing') e un transcriptJobRef persistito: sono i job da riprendere
   * dopo un riavvio. Scansione una tantum al boot (i processing sono rari).
   */
  private async findPendingTranscriptionJobs(): Promise<
    Array<{ tenantId: string; courseId: string; lessonId: string; blockId: string; jobRef: string }>
  > {
    const lessons = await this.prisma.lesson.findMany({
      select: { id: true, blocks: true, module: { select: { course: { select: { id: true, tenantId: true } } } } },
    });
    const out: Array<{ tenantId: string; courseId: string; lessonId: string; blockId: string; jobRef: string }> = [];
    for (const lesson of lessons) {
      const blocks = Array.isArray(lesson.blocks) ? (lesson.blocks as Array<Record<string, unknown>>) : [];
      for (const b of blocks) {
        if (b?.type !== 'video_checkpoint') continue;
        const payload = (b.payload ?? {}) as Record<string, unknown>;
        if (payload.transcriptStatus !== 'processing') continue;
        const jobRef = payload.transcriptJobRef;
        if (typeof jobRef !== 'string' || !jobRef) continue;
        out.push({
          tenantId: lesson.module.course.tenantId,
          courseId: lesson.module.course.id,
          lessonId: lesson.id,
          blockId: b.id as string,
          jobRef,
        });
      }
    }
    return out;
  }
}

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function extForContentType(ct: string): string {
  if (ct.includes('jpeg')) return 'jpg';
  if (ct.includes('webp')) return 'webp';
  return 'png';
}

/** Estensione file per i MIME video supportati (null se non supportato). */
function extForVideoMime(mime: string): string | null {
  switch (mime) {
    case 'video/mp4':
      return 'mp4';
    case 'video/webm':
      return 'webm';
    default:
      return null;
  }
}

/** Estensione file per i MIME immagine ammessi dalla creazione avatar (JPG/PNG). */
function extForImageMime(mime: string): string | null {
  switch (mime) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    default:
      return null;
  }
}

/**
 * Estrae il messaggio grezzo dell'errore di trascrizione per i log: usa la
 * `cause` quando presente (gli adapter avvolgono l'errore del provider in
 * ProviderUnavailableError mettendo la ragione reale nella cause).
 */
function rawTranscriptionError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) return cause.message;
    return err.message;
  }
  return 'errore sconosciuto';
}

/**
 * Traduce l'errore del provider ASR in un messaggio chiaro per l'autore. I
 * casi noti di Amazon Transcribe (audio non leggibile, nessun parlato, formato)
 * diventano istruzioni azionabili; gli altri cadono su un messaggio generico.
 */
function describeTranscriptionError(err: unknown): string {
  const raw = rawTranscriptionError(err).toLowerCase();
  if (raw.includes('failed to parse audio') || raw.includes('invalid audio') || raw.includes('no audio')) {
    return 'Il video non ha una traccia audio leggibile. Carica un video con audio parlato oppure inserisci la trascrizione manualmente.';
  }
  if (raw.includes('language') || raw.includes('speech')) {
    return 'Non è stato rilevato parlato riconoscibile nel video. Verifica che contenga una voce chiara oppure inserisci la trascrizione manualmente.';
  }
  if (raw.includes('timeout')) {
    return 'La trascrizione ha impiegato troppo tempo ed è stata interrotta. Riprova o inserisci la trascrizione manualmente.';
  }
  if (raw.includes('format') || raw.includes('mediaformat')) {
    return 'Formato video non supportato dal servizio di trascrizione. Usa un MP4 o WebM con audio AAC/standard, oppure inserisci la trascrizione manualmente.';
  }
  return 'Trascrizione automatica non riuscita. Puoi inserire la trascrizione manualmente.';
}

/** Attesa non bloccante usata dal polling dei job di trascrizione. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Scarica i byte di un video dato un URL. Supporta sia gli URL http(s)
 * presigned di HeyGen sia i `data:` URL del provider mock (sviluppo/test),
 * così il percorso di download funziona anche offline.
 */
async function downloadVideo(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (url.startsWith('data:')) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
    if (!match) throw new Error('data: URL non valido');
    const contentType = match[1] || 'video/mp4';
    const isBase64 = Boolean(match[2]);
    const data = match[3] ?? '';
    const bytes = isBase64
      ? new Uint8Array(Buffer.from(data, 'base64'))
      : new Uint8Array(Buffer.from(decodeURIComponent(data), 'utf8'));
    return { bytes, contentType };
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download video ${res.status}`);
  const contentType = res.headers.get('content-type') ?? 'video/mp4';
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, contentType };
}

/** Scarica testo (es. un file SRT) da un URL http(s) o da un data: URL. */
async function downloadText(url: string): Promise<string> {
  if (url.startsWith('data:')) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
    if (!match) throw new Error('data: URL non valido');
    const isBase64 = Boolean(match[2]);
    const data = match[3] ?? '';
    return isBase64 ? Buffer.from(data, 'base64').toString('utf8') : decodeURIComponent(data);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download sottotitoli ${res.status}`);
  return res.text();
}

/**
 * Converte un file SRT (SubRip) in cue di trascrizione karaoke. Formato:
 *   1
 *   00:00:00,000 --> 00:00:02,000
 *   Testo della riga (una o più righe)
 *   <riga vuota>
 * Robusto a CRLF, BOM e separatori decimali con virgola o punto. Ritorna cue
 * ordinate per start con start/end in secondi.
 */
function parseSrtToCues(
  srt: string,
): Array<{ id: string; start: number; end: number; text: string }> {
  const clean = srt.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = clean.split(/\n{2,}/);
  const toSec = (t: string): number => {
    const m = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/.exec(t.trim());
    if (!m) return NaN;
    const h = Number(m[1]);
    const min = Number(m[2]);
    const s = Number(m[3]);
    const ms = Number((m[4] ?? '0').padEnd(3, '0'));
    return h * 3600 + min * 60 + s + ms / 1000;
  };
  const cues: Array<{ id: string; start: number; end: number; text: string }> = [];
  let i = 0;
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    // La prima riga può essere l'indice numerico: in tal caso la riga tempi è la seconda.
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx === -1) continue;
    const [startRaw, endRaw] = lines[timeIdx]!.split('-->');
    const start = toSec(startRaw ?? '');
    const end = toSec(endRaw ?? '');
    const text = lines
      .slice(timeIdx + 1)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!Number.isFinite(start) || !text) continue;
    cues.push({ id: `cue-${i++}`, start, end: Number.isFinite(end) ? end : start, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** Messaggio grezzo dell'errore di generazione video (per i log). */
function rawVideoGenError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) return cause.message;
    return err.message;
  }
  return typeof err === 'string' ? err : 'errore sconosciuto';
}

/**
 * True se l'errore di avvio del job cartoon è TRANSITORIO e vale la pena
 * ritentare: sottoscrizione Marketplace ancora in attivazione (tipico al primo
 * uso di un modello Bedrock Marketplace come Luma Ray), throttling o errori
 * di servizio temporanei. Gli errori di configurazione/permessi NON sono
 * transitori e vanno rilanciati subito.
 */
function isTransientCartoonError(err: unknown): boolean {
  const raw = rawVideoGenError(err).toLowerCase();
  const name = err instanceof Error ? err.name.toLowerCase() : '';
  return (
    raw.includes('try again') ||
    raw.includes('after 5 minutes') ||
    raw.includes('subscription') ||
    raw.includes('marketplace') ||
    raw.includes('throttl') ||
    raw.includes('too many requests') ||
    raw.includes('rate exceeded') ||
    raw.includes('serviceunavailable') ||
    raw.includes('service unavailable') ||
    name.includes('throttling') ||
    name.includes('toomanyrequests') ||
    name.includes('serviceunavailable')
  );
}

/** Traduce l'errore del provider video in un messaggio chiaro per l'autore. */
function describeVideoGenError(raw: string): string {
  const r = raw.toLowerCase();
  if (r.includes('quota') || r.includes('limit') || r.includes('credit') || r.includes('insufficient')) {
    return 'Quota HeyGen esaurita. Hai raggiunto il limite di video del tuo piano. Riprova il mese prossimo o passa a un piano a pagamento.';
  }
  if (r.includes('unauthorized') || r.includes('api key') || r.includes('401') || r.includes('403')) {
    return 'Credenziali HeyGen non valide. Verifica HEYGEN_API_KEY.';
  }
  if (r.includes('avatar')) {
    return 'Avatar non valido o non disponibile. Scegli un altro avatar.';
  }
  if (r.includes('voice')) {
    return 'Voce non valida o non disponibile. Scegli un\'altra voce.';
  }
  if (r.includes('timeout')) {
    return 'La generazione del video ha impiegato troppo tempo. Riprova più tardi.';
  }
  return `Generazione video non riuscita: ${raw}`;
}

/** Rimuove i tag HTML e normalizza gli spazi per ottenere testo narrabile. */
function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
