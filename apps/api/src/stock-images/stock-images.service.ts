import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ObjectStorage, StockImageProvider, StockPhoto } from '@scorm/domain';
import type { StockImageResult } from '@scorm/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { OBJECT_STORAGE, STOCK_IMAGE_PROVIDER } from '../providers/provider.constants.js';

/** MediaRef immagine (parte che tocchiamo). */
interface ImageMediaRef {
  kind?: string;
  storageKey?: string;
  alt?: string;
  source?: string;
  attribution?: Record<string, unknown>;
  placeholderPrompt?: string;
}

/**
 * Libreria immagini stock (Unsplash/Pexels): ricerca (proxy) e collegamento di
 * un'immagine scelta a un MediaRef di un block. L'immagine viene SCARICATA e
 * salvata su storage (storageKey), così finisce nel pacchetto SCORM offline;
 * nel MediaRef viene scritta anche l'attribuzione obbligatoria. Se il provider
 * non è configurato, la funzione è disabilitata (501).
 */
@Injectable()
export class StockImagesService {
  private readonly logger = new Logger(StockImagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Optional() @Inject(STOCK_IMAGE_PROVIDER) private readonly provider: StockImageProvider | null,
  ) {}

  private require(): StockImageProvider {
    if (!this.provider) {
      throw new NotImplementedException(
        'Libreria immagini stock non configurata (imposta STOCK_IMAGE_PROVIDER e la relativa API key)',
      );
    }
    return this.provider;
  }

  async search(query: string): Promise<{ provider: string; results: StockImageResult[] }> {
    const provider = this.require();
    const q = query.trim();
    if (!q) return { provider: provider.id, results: [] };
    const photos = await provider.search(q, { perPage: 24 });
    return { provider: provider.id, results: photos.map(toResult) };
  }

  /**
   * Scarica l'immagine scelta, la salva su storage e scrive storageKey +
   * attribuzione nel MediaRef immagine del block indicato. `mediaIndex` sceglie
   * quale immagine (per i block con array media); default: la prima.
   */
  async attachToBlock(
    tenantId: string,
    courseId: string,
    lessonId: string,
    input: { blockId: string; photoId: string; mediaIndex?: number; alt?: string },
  ): Promise<{ attached: true; url: string }> {
    const provider = this.require();
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, module: { course: { id: courseId, tenantId } } },
    });
    if (!lesson) throw new NotFoundException('Lezione non trovata');
    const blocks = Array.isArray(lesson.blocks) ? (lesson.blocks as unknown[]) : [];

    const ref = this.findImageRef(blocks, input.blockId, input.mediaIndex ?? 0);
    if (!ref) throw new NotFoundException('Nessun MediaRef immagine trovato nel block indicato');

    // Scarica i byte a piena risoluzione (+ attribuzione) e salva su storage.
    const asset = await provider.fetchFull(input.photoId);
    const ext = extForContentType(asset.contentType);
    const key = `media/${tenantId}/${courseId}/stock/${randomUUID()}.${ext}`;
    await this.storage.putObject(key, Buffer.from(asset.bytes), { contentType: asset.contentType });

    ref.kind = 'image';
    ref.source = 'stock';
    ref.storageKey = key;
    ref.alt = input.alt ?? asset.alt ?? ref.alt ?? '';
    ref.attribution = {
      provider: asset.attribution.provider,
      authorName: asset.attribution.authorName,
      ...(asset.attribution.authorUrl ? { authorUrl: asset.attribution.authorUrl } : {}),
      ...(asset.attribution.sourceUrl ? { sourceUrl: asset.attribution.sourceUrl } : {}),
    };
    // Il placeholderPrompt non serve più (l'immagine è materializzata).
    delete ref.placeholderPrompt;

    await this.prisma.lesson.update({
      where: { id: lessonId },
      data: { blocks: blocks as object, updatedAt: new Date() },
    });

    const url = await this.storage.getSignedUrl(key, { expiresInSec: 6 * 3600 });
    this.logger.log(`Stock image collegata (lezione ${lessonId}, block ${input.blockId}) via ${provider.id}`);
    return { attached: true, url };
  }

  /**
   * Scarica l'immagine stock scelta e la imposta come COPERTINA del corso
   * (coverImageKey) salvando anche l'attribuzione (credito obbligatorio).
   */
  async attachCover(
    tenantId: string,
    courseId: string,
    input: { photoId: string },
  ): Promise<{ attached: true; url: string }> {
    const provider = this.require();
    const course = await this.prisma.course.findFirst({ where: { id: courseId, tenantId } });
    if (!course) throw new NotFoundException('Corso non trovato');

    const asset = await provider.fetchFull(input.photoId);
    const ext = extForContentType(asset.contentType);
    const key = `media/${tenantId}/${courseId}/cover/${randomUUID()}.${ext}`;
    await this.storage.putObject(key, Buffer.from(asset.bytes), { contentType: asset.contentType });

    await this.prisma.course.update({
      where: { id: courseId },
      data: { coverImageKey: key, coverAttribution: toAttribution(asset.attribution) },
    });

    const url = await this.storage.getSignedUrl(key, { expiresInSec: 6 * 3600 });
    this.logger.log(`Copertina corso ${courseId} impostata da stock (${provider.id})`);
    return { attached: true, url };
  }

  /**
   * Come attachCover ma per la copertina di un MODULO (module.coverImageKey).
   */
  async attachModuleCover(
    tenantId: string,
    courseId: string,
    moduleId: string,
    input: { photoId: string },
  ): Promise<{ attached: true; url: string }> {
    const provider = this.require();
    const module = await this.prisma.module.findFirst({
      where: { id: moduleId, course: { id: courseId, tenantId } },
    });
    if (!module) throw new NotFoundException('Modulo non trovato');

    const asset = await provider.fetchFull(input.photoId);
    const ext = extForContentType(asset.contentType);
    const key = `media/${tenantId}/${courseId}/modules/${moduleId}/cover/${randomUUID()}.${ext}`;
    await this.storage.putObject(key, Buffer.from(asset.bytes), { contentType: asset.contentType });

    await this.prisma.module.update({
      where: { id: moduleId },
      data: { coverImageKey: key, coverAttribution: toAttribution(asset.attribution) },
    });

    const url = await this.storage.getSignedUrl(key, { expiresInSec: 6 * 3600 });
    this.logger.log(`Copertina modulo ${moduleId} impostata da stock (${provider.id})`);
    return { attached: true, url };
  }

  /**
   * Trova il MediaRef immagine n-esimo (indice globale) nel block indicato.
   * Visita ricorsiva: raccoglie tutti gli oggetti con kind 'image' (o i membri
   * di un array `media`/campo `image`) e ritorna quello all'indice richiesto.
   */
  private findImageRef(blocks: unknown[], blockId: string, index: number): ImageMediaRef | null {
    const target = blocks.find((b) => (b as { id?: string }).id === blockId);
    if (!target) return null;
    const found: ImageMediaRef[] = [];
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (node === null || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (obj.kind === 'image') found.push(obj as ImageMediaRef);
      for (const v of Object.values(obj)) visit(v);
    };
    visit(target);
    return found[index] ?? found[0] ?? null;
  }
}

function toResult(p: StockPhoto): StockImageResult {
  return {
    id: p.id,
    provider: p.provider,
    thumbUrl: p.thumbUrl,
    alt: p.alt,
    authorName: p.attribution.authorName,
    ...(p.attribution.authorUrl ? { authorUrl: p.attribution.authorUrl } : {}),
    ...(p.attribution.sourceUrl ? { sourceUrl: p.attribution.sourceUrl } : {}),
    ...(p.width ? { width: p.width } : {}),
    ...(p.height ? { height: p.height } : {}),
  };
}

/** Normalizza l'attribuzione stock in oggetto JSON per il DB/MediaRef. */
function toAttribution(attr: {
  provider: string;
  authorName: string;
  authorUrl?: string;
  sourceUrl?: string;
}): Record<string, string> {
  return {
    provider: attr.provider,
    authorName: attr.authorName,
    ...(attr.authorUrl ? { authorUrl: attr.authorUrl } : {}),
    ...(attr.sourceUrl ? { sourceUrl: attr.sourceUrl } : {}),
  };
}

function extForContentType(ct: string): string {
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  return 'jpg';
}
