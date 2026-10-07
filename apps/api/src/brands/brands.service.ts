import { Injectable, NotFoundException } from '@nestjs/common';
import { Brand, type Brand as BrandType } from '@scorm/contracts';
import { compileTheme, type CompiledTheme } from '@scorm/scorm';
import { PrismaService } from '../prisma/prisma.service.js';
import { QuotaService } from '../plans/quota.service.js';

/** Input di creazione/aggiornamento brand: la definizione senza id/tenantId. */
export type BrandDefinition = Omit<BrandType, 'id' | 'tenantId'>;

export interface BrandView extends BrandType {}

/**
 * Gestione dei brand del tenant (Requisito 7). La definizione (asset, colori,
 * tipografia, voice, legal) è validata con lo schema Brand dei contratti e
 * salvata come JSONB su Brand.definition. Il numero di brand è soggetto a quota.
 */
@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
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
    return rows.map((r) => this.toView(r.id, tenantId, r.definition));
  }

  async get(tenantId: string, brandId: string): Promise<BrandView> {
    const row = await this.requireBrand(tenantId, brandId);
    return this.toView(row.id, tenantId, row.definition);
  }

  async delete(tenantId: string, brandId: string): Promise<void> {
    await this.requireBrand(tenantId, brandId);
    await this.prisma.brand.delete({ where: { id: brandId } });
  }

  /** Compila e restituisce il tema CSS del brand (anteprima; Requisito 7.2). */
  async compileTheme(tenantId: string, brandId: string): Promise<CompiledTheme> {
    const brand = await this.get(tenantId, brandId);
    return compileTheme(brand);
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

  private toView(id: string, tenantId: string, definition: unknown): BrandView {
    // Ricompone il Brand completo validando la definizione salvata.
    return Brand.parse({ ...(definition as object), id, tenantId });
  }
}
