import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  Brand,
  BRAND_STORAGE_PREFIX,
  type Brand as BrandType,
  type BrandView as BrandViewType,
} from '@scorm/contracts';
import type { ObjectStorage } from '@scorm/domain';
import { compileTheme, type CompiledTheme } from '@scorm/scorm';
import { PrismaService } from '../prisma/prisma.service.js';
import { QuotaService } from '../plans/quota.service.js';
import { OBJECT_STORAGE } from '../providers/provider.constants.js';

/** Input di creazione/aggiornamento brand: la definizione senza id/tenantId. */
export type BrandDefinition = Omit<BrandType, 'id' | 'tenantId'>;

export type BrandView = BrandViewType;

/** TTL dell'URL firmato del logo (anteprima/tema). 24h come il branding white-label. */
const LOGO_URL_TTL_SEC = 24 * 3600;

/** MIME ammessi per il logo del brand → estensione file (null se non supportato). */
function extForLogoMime(mime: string): string | null {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/svg+xml':
      return 'svg';
    case 'image/webp':
      return 'webp';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    default:
      return null;
  }
}

/**
 * Gestione dei brand del tenant (Requisito 7). La definizione (asset, colori,
 * tipografia, voice, legal) è validata con lo schema Brand dei contratti e
 * salvata come JSONB su Brand.definition. Il numero di brand è soggetto a quota.
 *
 * Il logo primario (`assets.logoPrimaryUrl`) può essere:
 *  - un URL esterno (incollato dall'utente), usato così com'è; oppure
 *  - una chiave di object storage (prefisso "storage:") per i loghi caricati:
 *    il valore persistito è stabile, e in lettura viene risolto in un URL
 *    firmato temporaneo esposto come `logoDisplayUrl` (mai persistito).
 */
@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async create(tenantId: string, definition: BrandDefinition): Promise<BrandView> {
    await this.quota.assertWithinLimit(tenantId, 'brands');
    // Valida la definizione completa componendo id/tenantId provvisori.
    const validated = this.validate(tenantId, 'pending', definition);
    const row = await this.prisma.brand.create({
      data: {
        tenantId,
        name: validated.name,
        definition: this.stripIdentity(validated) as object,
      },
    });
    return this.toView(row.id, tenantId, row.definition);
  }

  async update(tenantId: string, brandId: string, definition: BrandDefinition): Promise<BrandView> {
    await this.requireBrand(tenantId, brandId);
    const validated = this.validate(tenantId, brandId, definition);
    const row = await this.prisma.brand.update({
      where: { id: brandId },
      data: {
        name: validated.name,
        definition: this.stripIdentity(validated) as object,
      },
    });
    return this.toView(row.id, tenantId, row.definition);
  }

  async list(tenantId: string): Promise<BrandView[]> {
    const rows = await this.prisma.brand.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(rows.map((r) => this.toView(r.id, tenantId, r.definition)));
  }

  async get(tenantId: string, brandId: string): Promise<BrandView> {
    const row = await this.requireBrand(tenantId, brandId);
    return this.toView(row.id, tenantId, row.definition);
  }

  async delete(tenantId: string, brandId: string): Promise<void> {
    await this.requireBrand(tenantId, brandId);
    await this.prisma.brand.delete({ where: { id: brandId } });
  }

  /**
   * Carica un file immagine come logo del brand su object storage e salva la
   * sua chiave (prefisso "storage:") in `assets.logoPrimaryUrl`, restituendo il
   * brand aggiornato con l'URL firmato per l'anteprima. Max 2MB, PNG/SVG/WebP/JPG.
   */
  async uploadLogo(
    tenantId: string,
    brandId: string,
    file: { mimeType: string; content: Buffer },
  ): Promise<BrandView> {
    const row = await this.requireBrand(tenantId, brandId);
    const ext = extForLogoMime(file.mimeType);
    if (!ext) {
      throw new BadRequestException('Formato non supportato (usa PNG, SVG, WebP o JPG).');
    }
    const MAX_BYTES = 2 * 1024 * 1024;
    if (file.content.byteLength > MAX_BYTES) {
      throw new BadRequestException('File troppo grande (max 2MB).');
    }
    const key = `brands/${tenantId}/${brandId}/logo-${randomUUID()}.${ext}`;
    await this.storage.putObject(key, file.content, { contentType: file.mimeType });

    // Aggiorna solo il logo primario della definizione esistente.
    const current = Brand.parse({
      ...(row.definition as object),
      id: brandId,
      tenantId,
    });
    const next = Brand.parse({
      ...current,
      assets: { ...current.assets, logoPrimaryUrl: `${BRAND_STORAGE_PREFIX}${key}` },
    });
    const saved = await this.prisma.brand.update({
      where: { id: brandId },
      data: { definition: this.stripIdentity(next) as object },
    });
    return this.toView(saved.id, tenantId, saved.definition);
  }

  /** Compila e restituisce il tema CSS del brand (anteprima; Requisito 7.2). */
  async compileTheme(tenantId: string, brandId: string): Promise<CompiledTheme> {
    const brand = await this.get(tenantId, brandId);
    // Il tema usa l'URL risolto del logo (firmato) al posto della chiave grezza.
    return compileTheme({
      ...brand,
      assets: { ...brand.assets, logoPrimaryUrl: brand.logoDisplayUrl ?? '' },
    });
  }

  private async requireBrand(tenantId: string, brandId: string) {
    const row = await this.prisma.brand.findFirst({ where: { id: brandId, tenantId } });
    if (!row) throw new NotFoundException('Brand non trovato');
    return row;
  }

  /** Valida la definizione come Brand completo (con id/tenantId). */
  private validate(tenantId: string, brandId: string, definition: BrandDefinition): BrandType {
    return Brand.parse({ ...definition, id: brandId, tenantId });
  }

  private stripIdentity(brand: BrandType): BrandDefinition {
    const { id: _id, tenantId: _tenantId, ...rest } = brand;
    return rest;
  }

  /**
   * Risolve il logo per la visualizzazione: le chiavi di storage ("storage:…")
   * diventano URL firmati temporanei; gli URL esterni restano invariati; vuoto
   * → null. Non modifica mai il valore canonico in `assets.logoPrimaryUrl`.
   */
  private async resolveLogoDisplayUrl(logo: string): Promise<string | null> {
    if (!logo) return null;
    if (logo.startsWith(BRAND_STORAGE_PREFIX)) {
      const key = logo.slice(BRAND_STORAGE_PREFIX.length);
      try {
        return await this.storage.getSignedUrl(key, { expiresInSec: LOGO_URL_TTL_SEC });
      } catch {
        return null;
      }
    }
    return logo;
  }

  private async toView(id: string, tenantId: string, definition: unknown): Promise<BrandView> {
    // Ricompone il Brand completo validando la definizione salvata.
    const brand = Brand.parse({ ...(definition as object), id, tenantId });
    const logoDisplayUrl = await this.resolveLogoDisplayUrl(brand.assets.logoPrimaryUrl);
    return { ...brand, logoDisplayUrl };
  }
}
