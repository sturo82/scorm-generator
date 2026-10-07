import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import type { ImageProvider, LLMProvider, ObjectStorage, SpeechProvider, TranscriptionProvider } from '@scorm/domain';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageMeterService } from '../metering/usage-meter.service.js';
import {
  IMAGE_PROVIDER,
  LLM_PROVIDER,
  OBJECT_STORAGE,
  SPEECH_PROVIDER,
  TRANSCRIPTION_PROVIDER,
} from '../providers/provider.constants.js';

/** Contesto di attribuzione costi passato alle operazioni media. */
interface MeterCtx {
  tenantId: string;
  courseId: string;
}

/** Durata dell'URL firmato per l'anteprima dei media. */
const MEDIA_URL_TTL_SEC = 6 * 3600;

/** Timeout e intervallo del polling dei job di trascrizione (lato servizio). */
const TRANSCRIPTION_POLL_TIMEOUT_MS = 15 * 60_000;
const TRANSCRIPTION_POLL_INTERVAL_MS = 5_000;

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
  ): Promise<GenerateNarrationResult> {
    const lesson = await this.requireLesson(tenantId, courseId, lessonId);
    const course = await this.prisma.course.findFirst({ where: { id: courseId, tenantId } });
    const blocks = Array.isArray(lesson.blocks) ? (lesson.blocks as unknown[]) : [];

    const text = this.extractNarrationText(blocks);
    if (!text) throw new NotFoundException('Nessun testo narrabile nella lezione');

    const result = await this.speech.synthesize({
      text,
      language: course?.language ? `${course.language}-${course.language.toUpperCase()}` : 'it-IT',
    });
    const key = `media/${tenantId}/${courseId}/audio/${lessonId}.mp3`;
    await this.storage.putObject(key, Buffer.from(result.bytes), {
      contentType: result.contentType,
    });
    // Metering: Polly fattura per carattere sintetizzato (unità di billing).
    await this.meter.record({
      tenantId,
      courseId,
      provider: 'POLLY',
      model: `polly-${this.config.get('media', { infer: true }).speechEngine}`,
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
    if (typeof this.transcription.fetchJob !== 'function') return;
    try {
      const pending = await this.findPendingTranscriptionJobs();
      if (pending.length === 0) return;
      this.logger.log(`Ripresa ${pending.length} trascrizione/i in sospeso dopo il riavvio`);
      for (const job of pending) {
        void this.pollTranscriptionJob(
          { tenantId: job.tenantId, courseId: job.courseId, lessonId: job.lessonId, blockId: job.blockId },
          job.jobRef,
        );
      }
    } catch (err) {
      this.logger.warn(`Ripresa trascrizioni non riuscita: ${err instanceof Error ? err.message : 'errore'}`);
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
