import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ObjectStorage } from '@scorm/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { OBJECT_STORAGE } from '../providers/provider.constants.js';
import { pdfToSlides, PdfSlidesInputError } from './pdf-slides.js';
import { isLibrary } from './slide-owner.js';
import { VIDEO_SCRIPT, type UpdateVideoImport, type VideoScriptSource } from '@scorm/contracts';

/** Dimensione massima del PDF caricato. */
export const SLIDES_MAX_PDF_BYTES = 50 * 1024 * 1024;
const PREVIEW_URL_TTL_SEC = 6 * 3600;

/** Slide importata, come salvata nel manifest. */
export interface ImportedSlide {
  index: number;
  /** Immagine della slide; per un video è il fotogramma di copertina (miniatura e sfondo sfocato). */
  imageKey: string;
  text: string;
  /** Solo negli import da video. */
  video?: ImportedVideo;
}

/** Un video caricato in un import "da video": il capitolo che l'avatar racconta. */
export interface ImportedVideo {
  key: string;
  filename: string;
  contentType: string;
  /** Durata del file intero (s). */
  fileDurationSec: number;
  /** Tratto usato (s); assente = video intero. */
  trim?: { start: number; end: number };
  /** Fotogrammi del tratto usato, per far scrivere il copione guardando il video. */
  frameKeys: string[];
  /** Fonte del copione. */
  mode: VideoScriptSource;
  hint?: string;
  script?: string;
  /** Il copione parte anche dal parlato del video (trascrizione del file, ritagliata sul tratto). */
  transcribe?: boolean;
}

/**
 * Identificatore del file sorgente: più capitoli (spezzoni) possono usare lo stesso file, e
 * condividono la stessa chiave di storage. È il nome dell'oggetto, senza il percorso.
 */
export function sourceIdOf(key: string): string {
  return key.split('/').pop() ?? key;
}

/** Durata effettiva di un video dell'import (il tratto scelto, o il file intero). */
export function videoDurationSec(v: ImportedVideo): number {
  return v.trim ? Math.max(0.5, v.trim.end - v.trim.start) : v.fileDurationSec;
}

export interface SlideImportManifest {
  importId: string;
  courseId: string;
  filename: string;
  createdAt: string;
  /** Lingua dei copioni per gli import in libreria (nei corsi vale la lingua del corso). */
  language?: string;
  /** 'videos' = import da video: ogni elemento è un video al posto della slide. */
  kind?: 'slides' | 'videos';
  slides: ImportedSlide[];
}

export interface SlideImportView extends Omit<SlideImportManifest, 'slides'> {
  slides: Array<
    Omit<ImportedSlide, 'video'> & {
      imageUrl: string;
      video?: Omit<ImportedVideo, 'key' | 'frameKeys'> & { url: string; durationSec: number; frames: number; sourceId: string };
    }
  >;
}

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const VIDEO_TYPES: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };

/**
 * Importazione di slide da PDF. Per ogni import salva su storage i PNG delle
 * pagine e un `manifest.json` con il testo; le fasi successive (copioni, clip
 * avatar) leggono il manifest tramite `importId`. Nessuna tabella dedicata: lo
 * storage è tenant-scoped dalla chiave e il manifest è l'unica fonte di verità.
 */
@Injectable()
export class SlidesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  private prefix(tenantId: string, courseId: string, importId: string): string {
    return `media/${tenantId}/${courseId}/slides/${importId}`;
  }

  async importPdf(input: {
    tenantId: string;
    courseId: string;
    filename: string;
    content: Buffer;
    /** Lingua dei copioni (solo per la libreria). */
    language?: string;
  }): Promise<SlideImportView> {
    if (input.content.byteLength === 0) throw new BadRequestException('File vuoto');
    if (input.content.byteLength > SLIDES_MAX_PDF_BYTES) {
      throw new BadRequestException(`PDF troppo grande (max ${SLIDES_MAX_PDF_BYTES / 1024 / 1024} MB)`);
    }
    await this.requireOwner(input.tenantId, input.courseId);

    let pages;
    try {
      pages = await pdfToSlides(input.content);
    } catch (e) {
      if (e instanceof PdfSlidesInputError) throw new BadRequestException(e.message);
      throw e;
    }

    const importId = randomUUID();
    const prefix = this.prefix(input.tenantId, input.courseId, importId);
    const slides: ImportedSlide[] = [];
    for (const p of pages) {
      const imageKey = `${prefix}/${String(p.index).padStart(3, '0')}.png`;
      await this.storage.putObject(imageKey, p.png, {
        contentType: 'image/png',
        custom: { tenantId: input.tenantId, importId },
      });
      slides.push({ index: p.index, imageKey, text: p.text });
    }
    const manifest: SlideImportManifest = {
      importId,
      courseId: input.courseId,
      filename: input.filename,
      createdAt: new Date().toISOString(),
      language: isLibrary(input.courseId) ? (input.language || 'it').slice(0, 8) : undefined,
      slides,
    };
    await this.storage.putObject(`${prefix}/manifest.json`, Buffer.from(JSON.stringify(manifest)), {
      contentType: 'application/json',
    });
    return this.toView(manifest);
  }

  /**
   * Sostituisce le immagini delle slide con quelle di un PDF aggiornato (stesse pagine,
   * stessi contenuti: ad esempio riesportato con i font corretti) MANTENENDO copioni, clip
   * avatar e lezioni già create. Le chiavi delle immagini restano le stesse, quindi niente
   * altro va ricollegato. Rifiuta PDF con un numero di pagine diverso o con pagine che non
   * corrispondono per testo alle precedenti, perché i copioni e le clip sono legati alla
   * posizione di ogni slide.
   */
  async replacePdf(input: {
    tenantId: string;
    courseId: string;
    importId: string;
    filename: string;
    content: Buffer;
  }): Promise<SlideImportView & { warnings: string[] }> {
    if (input.content.byteLength === 0) throw new BadRequestException('File vuoto');
    if (input.content.byteLength > SLIDES_MAX_PDF_BYTES) {
      throw new BadRequestException(`PDF troppo grande (max ${SLIDES_MAX_PDF_BYTES / 1024 / 1024} MB)`);
    }
    const manifest = await this.loadManifest(input.tenantId, input.courseId, input.importId);
    if (manifest.kind === 'videos') throw new BadRequestException('Questo import è fatto di video, non di slide');
    let pages;
    try {
      pages = await pdfToSlides(input.content);
    } catch (e) {
      if (e instanceof PdfSlidesInputError) throw new BadRequestException(e.message);
      throw e;
    }
    if (pages.length > manifest.slides.length) {
      throw new BadRequestException(
        `Il nuovo PDF ha ${pages.length} pagine, l'import ne ha ${manifest.slides.length}: servono le stesse pagine, ` +
          'altrimenti copioni e clip non corrisponderebbero. Per un PDF diverso avvia un nuovo import.',
      );
    }
    // Meno pagine dell'import: ammesso solo se le slide in più (es. un mazzo duplicato) sono già
    // ESCLUSE dal video; si sostituiscono le prime N e le altre restano come sono, inutilizzate.
    if (pages.length < manifest.slides.length) {
      const scriptsKey = `${this.prefix(input.tenantId, input.courseId, input.importId)}/scripts.json`;
      if (!(await this.storage.exists(scriptsKey))) {
        throw new BadRequestException(
          `Il nuovo PDF ha ${pages.length} pagine, l'import ne ha ${manifest.slides.length}: genera prima i copioni ed escludi le slide in più.`,
        );
      }
      const scripts = JSON.parse((await this.storage.getObject(scriptsKey)).toString('utf8')) as {
        slides: Array<{ index: number; skip: boolean; extra?: unknown }>;
      };
      const stillUsed = scripts.slides
        .filter((x) => !x.extra && x.index > pages.length && !x.skip)
        .map((x) => x.index);
      if (stillUsed.length > 0) {
        const missing = findMissingPages(manifest.slides.map((x) => x.text), pages.map((x) => x.text));
        const hint = missing.length > 0
          ? ` Sembra mancare la pagina ${missing.join(', ')} (${missing
              .map((i) => `«${firstLine(manifest.slides[i - 1]!.text)}»`)
              .join(', ')}): se è una slide nascosta, riesporta il PDF includendo le slide nascoste.`
          : '';
        throw new BadRequestException(
          `Il nuovo PDF ha ${pages.length} pagine ma il video usa ${Math.max(...stillUsed)} slide: servono le stesse pagine.${hint}`,
        );
      }
    }
    // Controllo di corrispondenza pagina per pagina (testo normalizzato, insensibile a font e spaziatura).
    const mismatched: number[] = [];
    pages.forEach((p, i) => {
      if (textSimilarity(manifest.slides[i]!.text, p.text) < 0.5) mismatched.push(p.index);
    });
    if (mismatched.length > Math.max(2, Math.floor(pages.length * 0.1))) {
      throw new BadRequestException(
        `Il nuovo PDF non sembra lo stesso documento: le pagine ${mismatched.slice(0, 10).join(', ')}${mismatched.length > 10 ? '…' : ''} hanno un testo molto diverso.`,
      );
    }
    for (let i = 0; i < pages.length; i++) {
      const slide = manifest.slides[i]!;
      await this.storage.putObject(slide.imageKey, pages[i]!.png, {
        contentType: 'image/png',
        custom: { tenantId: input.tenantId, importId: input.importId },
      });
      slide.text = pages[i]!.text;
    }
    manifest.filename = input.filename;
    await this.storage.putObject(
      `${this.prefix(input.tenantId, input.courseId, input.importId)}/manifest.json`,
      Buffer.from(JSON.stringify(manifest)),
      { contentType: 'application/json' },
    );
    const view = await this.toView(manifest);
    return {
      ...view,
      warnings: mismatched.length > 0 ? [`Pagine con testo diverso dal precedente: ${mismatched.join(', ')}`] : [],
    };
  }

  // --- Import da video --------------------------------------------------------

  /** Crea un import "da video" vuoto: i video si aggiungono uno alla volta. */
  async createVideoImport(input: { tenantId: string; courseId: string; title?: string; language?: string }): Promise<SlideImportView> {
    await this.requireOwner(input.tenantId, input.courseId);
    const manifest: SlideImportManifest = {
      importId: randomUUID(),
      courseId: input.courseId,
      filename: (input.title?.trim() || 'Video').slice(0, 200),
      createdAt: new Date().toISOString(),
      language: isLibrary(input.courseId) ? (input.language || 'it').slice(0, 8) : undefined,
      kind: 'videos',
      slides: [],
    };
    await this.saveManifest(input.tenantId, manifest);
    return this.toView(manifest);
  }

  /**
   * Aggiunge un video all'import, con il fotogramma di copertina e qualche fotogramma del tratto
   * (estratti dal browser: il server non decodifica video). La durata arriva dal browser e si
   * controlla che sia plausibile.
   *
   * Con `sourceId` non si carica nessun file: si aggiunge un nuovo capitolo (spezzone) che usa un
   * video già caricato in questo import. Arrivano solo copertina e fotogrammi del nuovo tratto.
   */
  async addVideo(input: {
    tenantId: string;
    courseId: string;
    importId: string;
    /** Il video nel corpo della richiesta (file piccoli) oppure già caricato a pezzi (`upload`). */
    video?: { filename: string; contentType: string; content?: Buffer; upload?: { key: string; uploadId: string; parts: Array<{ partNumber: number; etag: string }> } };
    /** Nuovo capitolo dallo stesso file di un capitolo già presente (nessun caricamento). */
    sourceId?: string;
    poster: { contentType: string; content: Buffer };
    frames: Array<{ contentType: string; content: Buffer }>;
    durationSec: number;
  }): Promise<SlideImportView> {
    const manifest = await this.loadManifest(input.tenantId, input.courseId, input.importId);
    if (manifest.kind !== 'videos') throw new BadRequestException('Questo import non è da video');
    if (await this.hasScripts(input.tenantId, input.courseId, input.importId)) {
      throw new ConflictException('I copioni sono già stati generati: per aggiungere video crea un nuovo import.');
    }
    if (manifest.slides.length >= VIDEO_SCRIPT.maxVideos) throw new BadRequestException(`Al massimo ${VIDEO_SCRIPT.maxVideos} video`);
    const shared = input.sourceId ? manifest.slides.find((x) => x.video && sourceIdOf(x.video.key) === input.sourceId)?.video : undefined;
    if (input.sourceId && !shared) throw new BadRequestException('Il video di partenza non è in questo import');
    const video = input.video;
    if (!shared) {
      if (!video) throw new BadRequestException('Video mancante');
      const vExt = VIDEO_TYPES[video.contentType];
      if (!vExt) throw new BadRequestException('Formato video non supportato (usa MP4, WebM o MOV)');
      if (video.content) {
        if (video.content.byteLength === 0) throw new BadRequestException('Video vuoto');
        if (video.content.byteLength > VIDEO_SCRIPT.maxVideoBytes) {
          throw new BadRequestException(`Video troppo grande (max ${VIDEO_SCRIPT.maxVideoBytes / 1024 / 1024} MB)`);
        }
      } else if (!video.upload) {
        throw new BadRequestException('Video mancante');
      }
      if (!Number.isFinite(input.durationSec) || input.durationSec < 1 || input.durationSec > 3600) {
        throw new BadRequestException('Durata del video non valida');
      }
    }
    const pExt = IMAGE_TYPES[input.poster.contentType];
    if (!pExt) throw new BadRequestException('Copertina del video non valida');
    const index = Math.max(0, ...manifest.slides.map((x) => x.index)) + 1;
    const prefix = this.prefix(input.tenantId, input.courseId, input.importId);
    const n = String(index).padStart(3, '0');
    const custom = { tenantId: input.tenantId, importId: input.importId };
    let key = shared?.key ?? '';
    if (!shared) {
      const vExt = VIDEO_TYPES[video!.contentType]!;
      key = `${prefix}/video-${n}.${vExt}`;
      if (video!.content) {
        await this.storage.putObject(key, video!.content, { contentType: video!.contentType, custom });
      } else {
        // Caricato a pezzi: si chiude il caricamento sulla chiave assegnata all'inizio (solo di questo import).
        const up = video!.upload!;
        if (!new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/upload-[0-9a-f-]{36}\\.(mp4|webm|mov)$`).test(up.key)) {
          throw new BadRequestException('Caricamento non valido');
        }
        if (!this.storage.completeMultipart || up.parts.length === 0) throw new BadRequestException('Caricamento non completo');
        await this.storage.completeMultipart(up.key, up.uploadId, up.parts);
        key = up.key;
      }
    }
    const imageKey = `${prefix}/${n}.${pExt}`;
    await this.storage.putObject(imageKey, input.poster.content, { contentType: input.poster.contentType, custom });
    const frameKeys: string[] = [];
    for (const [i, f] of input.frames.slice(0, 6).entries()) {
      const ext = IMAGE_TYPES[f.contentType];
      if (!ext || f.content.byteLength > 4 * 1024 * 1024) continue;
      const fk = `${prefix}/frames-${n}-${i + 1}.${ext}`;
      await this.storage.putObject(fk, f.content, { contentType: f.contentType, custom });
      frameKeys.push(fk);
    }
    manifest.slides.push({
      index,
      imageKey,
      text: '',
      video: {
        key,
        filename: shared ? shared.filename : video!.filename.slice(0, 200),
        contentType: shared ? shared.contentType : video!.contentType,
        fileDurationSec: shared ? shared.fileDurationSec : Math.round(input.durationSec * 100) / 100,
        frameKeys,
        mode: 'frames',
        ...(shared?.transcribe ? { transcribe: true } : {}),
      },
    });
    await this.saveManifest(input.tenantId, manifest);
    return this.toView(manifest);
  }

  /** Dimensione dei pezzi del caricamento: sotto il limite di una richiesta, sopra il minimo di S3 (5 MB). */
  static readonly VIDEO_PART_BYTES = 8 * 1024 * 1024;

  /** Apre il caricamento a pezzi di un video: il browser invia poi i pezzi uno alla volta. */
  async startVideoUpload(
    tenantId: string,
    courseId: string,
    importId: string,
    input: { contentType: string; sizeBytes: number },
  ): Promise<{ key: string; uploadId: string; partBytes: number; parts: number }> {
    const manifest = await this.loadManifest(tenantId, courseId, importId);
    if (manifest.kind !== 'videos') throw new BadRequestException('Questo import non è da video');
    const ext = VIDEO_TYPES[input.contentType];
    if (!ext) throw new BadRequestException('Formato video non supportato (usa MP4, WebM o MOV)');
    if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) throw new BadRequestException('Dimensione del video non valida');
    if (input.sizeBytes > VIDEO_SCRIPT.maxVideoBytes) {
      throw new BadRequestException(`Video troppo grande (max ${VIDEO_SCRIPT.maxVideoBytes / 1024 / 1024} MB)`);
    }
    if (!this.storage.startMultipart) throw new BadRequestException('Caricamento a pezzi non disponibile');
    const key = `${this.prefix(tenantId, courseId, importId)}/upload-${randomUUID()}.${ext}`;
    const { uploadId } = await this.storage.startMultipart(key, { contentType: input.contentType, custom: { tenantId, importId } });
    return { key, uploadId, partBytes: SlidesService.VIDEO_PART_BYTES, parts: Math.ceil(input.sizeBytes / SlidesService.VIDEO_PART_BYTES) };
  }

  /** Salva un pezzo del video (numerato da 1). */
  async uploadVideoPart(
    tenantId: string,
    courseId: string,
    importId: string,
    input: { key: string; uploadId: string; partNumber: number; body: Buffer },
  ): Promise<{ etag: string }> {
    await this.loadManifest(tenantId, courseId, importId);
    const prefix = this.prefix(tenantId, courseId, importId);
    if (!input.key.startsWith(`${prefix}/upload-`)) throw new BadRequestException('Caricamento non valido');
    const maxParts = Math.ceil(VIDEO_SCRIPT.maxVideoBytes / SlidesService.VIDEO_PART_BYTES);
    if (!Number.isInteger(input.partNumber) || input.partNumber < 1 || input.partNumber > maxParts) throw new BadRequestException('Pezzo non valido');
    if (input.body.byteLength === 0 || input.body.byteLength > SlidesService.VIDEO_PART_BYTES) throw new BadRequestException('Pezzo di dimensione non valida');
    if (!this.storage.uploadPart) throw new BadRequestException('Caricamento a pezzi non disponibile');
    return this.storage.uploadPart(input.key, input.uploadId, input.partNumber, input.body);
  }

  /** Annulla un caricamento a pezzi lasciato a metà (best-effort). */
  async abortVideoUpload(tenantId: string, courseId: string, importId: string, input: { key: string; uploadId: string }): Promise<void> {
    await this.loadManifest(tenantId, courseId, importId);
    if (!input.key.startsWith(`${this.prefix(tenantId, courseId, importId)}/upload-`)) throw new BadRequestException('Caricamento non valido');
    await this.storage.abortMultipart?.(input.key, input.uploadId).catch(() => undefined);
  }

  /**
   * Ordine, tratto e fonte del copione dei video. I video non elencati si tolgono dall'import.
   * Consentito solo prima della generazione dei copioni (i copioni sono legati alla posizione).
   */
  async updateVideos(tenantId: string, courseId: string, importId: string, input: UpdateVideoImport): Promise<SlideImportView> {
    const manifest = await this.loadManifest(tenantId, courseId, importId);
    if (manifest.kind !== 'videos') throw new BadRequestException('Questo import non è da video');
    if (await this.hasScripts(tenantId, courseId, importId)) {
      throw new ConflictException('I copioni sono già stati generati: modifica i copioni invece dei video.');
    }
    const byIndex = new Map(manifest.slides.map((x) => [x.index, x]));
    const seen = new Set<number>();
    const next: ImportedSlide[] = [];
    for (const [pos, v] of input.videos.entries()) {
      const cur = byIndex.get(v.index);
      if (!cur?.video) throw new BadRequestException(`Video ${v.index} inesistente`);
      if (seen.has(v.index)) throw new BadRequestException(`Video ${v.index} ripetuto`);
      seen.add(v.index);
      const full = cur.video.fileDurationSec;
      let trim = v.trim;
      if (trim) {
        const start = Math.min(Math.max(0, trim.start), full);
        const end = Math.min(Math.max(start + 1, trim.end), full);
        trim = end - start >= full - 0.05 ? undefined : { start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 };
      }
      if (v.mode === 'manual' && !v.script?.trim()) throw new BadRequestException(`Scrivi il copione del video ${pos + 1}, oppure lascialo scrivere all'AI`);
      if (v.mode === 'hint' && !v.hint?.trim()) throw new BadRequestException(`Scrivi l'indicazione per il video ${pos + 1}`);
      next.push({
        ...cur,
        index: pos + 1,
        video: {
          ...cur.video,
          trim,
          mode: v.mode,
          hint: v.mode === 'hint' ? v.hint?.trim() : undefined,
          script: v.mode === 'manual' ? v.script?.trim() : undefined,
          transcribe: v.transcribe ? true : undefined,
        },
      });
    }
    // La trascrizione riguarda il file intero: se la vuole un capitolo, vale per tutti gli spezzoni dello stesso file.
    const transcribed = new Set(next.filter((x) => x.video?.transcribe).map((x) => x.video!.key));
    for (const x of next) if (x.video && transcribed.has(x.video.key)) x.video.transcribe = true;
    manifest.slides = next;
    await this.saveManifest(tenantId, manifest);
    return this.toView(manifest);
  }

  private async hasScripts(tenantId: string, courseId: string, importId: string): Promise<boolean> {
    return this.storage.exists(`${this.prefix(tenantId, courseId, importId)}/scripts.json`);
  }

  private async saveManifest(tenantId: string, manifest: SlideImportManifest): Promise<void> {
    await this.storage.putObject(
      `${this.prefix(tenantId, manifest.courseId, manifest.importId)}/manifest.json`,
      Buffer.from(JSON.stringify(manifest)),
      { contentType: 'application/json' },
    );
  }

  /** Fotogrammi di un video dell'import (per l'AI che scrive il copione guardando il video). */
  async videoFrames(tenantId: string, courseId: string, importId: string, index: number): Promise<Array<{ format: 'jpeg' | 'png' | 'webp'; data: Buffer }>> {
    const manifest = await this.loadManifest(tenantId, courseId, importId);
    const v = manifest.slides.find((x) => x.index === index)?.video;
    if (!v) return [];
    const keys = v.frameKeys.length > 0 ? v.frameKeys : [manifest.slides.find((x) => x.index === index)!.imageKey];
    const out: Array<{ format: 'jpeg' | 'png' | 'webp'; data: Buffer }> = [];
    for (const k of keys) {
      const ext = k.split('.').pop() ?? '';
      const format = ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpeg';
      out.push({ format, data: await this.storage.getObject(k) });
    }
    return out;
  }

  async get(tenantId: string, courseId: string, importId: string): Promise<SlideImportView> {
    return this.toView(await this.loadManifest(tenantId, courseId, importId));
  }

  /** Manifest di un import (usato anche dalle fasi successive della pipeline). */
  async loadManifest(tenantId: string, courseId: string, importId: string): Promise<SlideImportManifest> {
    if (!/^[0-9a-f-]{36}$/i.test(importId)) throw new NotFoundException('Import non trovato');
    await this.requireOwner(tenantId, courseId);
    const key = `${this.prefix(tenantId, courseId, importId)}/manifest.json`;
    if (!(await this.storage.exists(key))) throw new NotFoundException('Import non trovato');
    return JSON.parse((await this.storage.getObject(key)).toString('utf8')) as SlideImportManifest;
  }

  /** Il corso deve appartenere al tenant; la libreria esiste sempre (i file sono già per tenant). */
  private async requireOwner(tenantId: string, courseId: string): Promise<void> {
    if (isLibrary(courseId)) return;
    const course = await this.prisma.course.findFirst({ where: { id: courseId, tenantId }, select: { id: true } });
    if (!course) throw new NotFoundException('Corso non trovato');
  }

  private async toView(m: SlideImportManifest): Promise<SlideImportView> {
    const slides = await Promise.all(
      m.slides.map(async ({ video, ...s }) => ({
        ...s,
        imageUrl: await this.storage.getSignedUrl(s.imageKey, { expiresInSec: PREVIEW_URL_TTL_SEC }),
        ...(video
          ? {
              video: {
                filename: video.filename,
                contentType: video.contentType,
                fileDurationSec: video.fileDurationSec,
                ...(video.trim ? { trim: video.trim } : {}),
                mode: video.mode,
                ...(video.hint ? { hint: video.hint } : {}),
                ...(video.script ? { script: video.script } : {}),
                ...(video.transcribe ? { transcribe: true } : {}),
                sourceId: sourceIdOf(video.key),
                url: await this.storage.getSignedUrl(video.key, { expiresInSec: PREVIEW_URL_TTL_SEC }),
                durationSec: videoDurationSec(video),
                frames: video.frameKeys.length,
              },
            }
          : {}),
      })),
    );
    return { ...m, slides };
  }
}

/** Insieme dei trigrammi di sole lettere minuscole: robusto a font, spazi e a capo diversi. */
function trigrams(text: string): Set<string> {
  const t = text.toLowerCase().replace(/[^a-zà-ÿ0-9]/g, '');
  const out = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}

/** Somiglianza 0..1 tra due testi (Jaccard sui trigrammi); due testi vuoti sono uguali. */
export function textSimilarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

/** Prima riga leggibile di una slide (per indicarla nei messaggi). */
function firstLine(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 3) ?? '';
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

/**
 * Pagine (1-based) dell'import che non compaiono nel nuovo PDF, allineando le due sequenze
 * per testo: individua i "salti" in cui la pagina nuova i corrisponde alla vecchia i+k.
 */
export function findMissingPages(oldTexts: string[], newTexts: string[]): number[] {
  const missing: number[] = [];
  let o = 0;
  for (let n = 0; n < newTexts.length && o < oldTexts.length; n++) {
    if (textSimilarity(oldTexts[o]!, newTexts[n]!) >= 0.5) {
      o++;
      continue;
    }
    // Cerca la pagina nuova poco più avanti tra le vecchie: le intermedie mancano.
    let found = -1;
    for (let k = 1; k <= 3 && o + k < oldTexts.length; k++) {
      if (textSimilarity(oldTexts[o + k]!, newTexts[n]!) >= 0.5) {
        found = o + k;
        break;
      }
    }
    if (found === -1) {
      o++;
      continue;
    }
    for (let m = o; m < found; m++) missing.push(m + 1);
    o = found + 1;
  }
  return missing;
}
