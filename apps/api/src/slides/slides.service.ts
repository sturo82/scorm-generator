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
