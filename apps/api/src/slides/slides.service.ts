import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ObjectStorage } from '@scorm/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { OBJECT_STORAGE } from '../providers/provider.constants.js';
import { pdfToSlides, PdfSlidesInputError } from './pdf-slides.js';

/** Dimensione massima del PDF caricato. */
export const SLIDES_MAX_PDF_BYTES = 50 * 1024 * 1024;
const PREVIEW_URL_TTL_SEC = 6 * 3600;

/** Slide importata, come salvata nel manifest. */
export interface ImportedSlide {
  index: number;
  imageKey: string;
  text: string;
}

export interface SlideImportManifest {
  importId: string;
  courseId: string;
  filename: string;
  createdAt: string;
  slides: ImportedSlide[];
}

export interface SlideImportView extends Omit<SlideImportManifest, 'slides'> {
  slides: Array<ImportedSlide & { imageUrl: string }>;
}

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
  }): Promise<SlideImportView> {
    if (input.content.byteLength === 0) throw new BadRequestException('File vuoto');
    if (input.content.byteLength > SLIDES_MAX_PDF_BYTES) {
      throw new BadRequestException(`PDF troppo grande (max ${SLIDES_MAX_PDF_BYTES / 1024 / 1024} MB)`);
    }
    const course = await this.prisma.course.findFirst({
      where: { id: input.courseId, tenantId: input.tenantId },
      select: { id: true },
    });
    if (!course) throw new NotFoundException('Corso non trovato');

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
      slides,
    };
    await this.storage.putObject(`${prefix}/manifest.json`, Buffer.from(JSON.stringify(manifest)), {
      contentType: 'application/json',
    });
    return this.toView(manifest);
  }

  async get(tenantId: string, courseId: string, importId: string): Promise<SlideImportView> {
    return this.toView(await this.loadManifest(tenantId, courseId, importId));
  }

  /** Manifest di un import (usato anche dalle fasi successive della pipeline). */
  async loadManifest(tenantId: string, courseId: string, importId: string): Promise<SlideImportManifest> {
    if (!/^[0-9a-f-]{36}$/i.test(importId)) throw new NotFoundException('Import non trovato');
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, tenantId },
      select: { id: true },
    });
    if (!course) throw new NotFoundException('Corso non trovato');
    const key = `${this.prefix(tenantId, courseId, importId)}/manifest.json`;
    if (!(await this.storage.exists(key))) throw new NotFoundException('Import non trovato');
    return JSON.parse((await this.storage.getObject(key)).toString('utf8')) as SlideImportManifest;
  }

  private async toView(m: SlideImportManifest): Promise<SlideImportView> {
    const slides = await Promise.all(
      m.slides.map(async (s) => ({
        ...s,
        imageUrl: await this.storage.getSignedUrl(s.imageKey, { expiresInSec: PREVIEW_URL_TTL_SEC }),
      })),
    );
    return { ...m, slides };
  }
}
