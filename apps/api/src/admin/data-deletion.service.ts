import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import type { ObjectStorage, VectorStore } from '@scorm/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { QuotaService } from '../plans/quota.service.js';
import { OBJECT_STORAGE, VECTOR_STORE } from '../providers/provider.constants.js';
import type { AuthContext } from '../auth/auth-context.js';
import { AuditService } from '../observability/audit.service.js';

export interface DataDeletionResult {
  deletedCourses: number;
  deletedDocuments: number;
  deletedBrands: number;
}

/**
 * Cancellazione dei dati di un tenant su richiesta (Requisito 12.5), riservata
 * ai piani con feature flag `dataDeletion`. Rimuove in cascata contenuti, brand,
 * documenti della knowledge, embeddings nel vector store e file nello storage.
 * Il tenant e gli utenti NON vengono eliminati: viene azzerato il contenuto.
 */
@Injectable()
export class DataDeletionService {
  private readonly logger = new Logger(DataDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(VECTOR_STORE) private readonly vectors: VectorStore,
  ) {}

  async deleteTenantContent(ctx: AuthContext): Promise<DataDeletionResult> {
    const tenantId = ctx.tenant.tenantId;

    // Gate sul feature flag del piano (Requisito 12.5).
    const enabled = await this.quota.isFeatureEnabled(tenantId, 'dataDeletion');
    if (!enabled) {
      throw new ForbiddenException('La cancellazione dati non è inclusa nel piano corrente');
    }

    // 1. Documenti: rimuove embeddings e file sorgente, poi i record.
    const docs = await this.prisma.knowledgeDoc.findMany({
      where: { tenantId },
      select: { id: true, storageKey: true },
    });
    for (const doc of docs) {
      await safe(() => this.vectors.deleteByDocument({ tenantId }, doc.id), this.logger);
      await safe(() => this.storage.deleteObject(doc.storageKey), this.logger);
    }

    // 2. Pacchetti SCORM: rimuove gli zip dallo storage.
    const packages = await this.prisma.scormPackage.findMany({
      where: { build: { course: { tenantId } }, storageKey: { not: null } },
      select: { storageKey: true },
    });
    for (const pkg of packages) {
      if (pkg.storageKey) await safe(() => this.storage.deleteObject(pkg.storageKey!), this.logger);
    }

    // 3. Record DB: le FK onDelete:Cascade rimuovono moduli/lezioni/assessment/
    //    build/pacchetti/versioni/job collegati ai corsi e ai documenti.
    const counts = await this.prisma.$transaction([
      this.prisma.course.deleteMany({ where: { tenantId } }),
      this.prisma.knowledgeDoc.deleteMany({ where: { tenantId } }),
      this.prisma.brand.deleteMany({ where: { tenantId } }),
    ]);

    const result: DataDeletionResult = {
      deletedCourses: counts[0].count,
      deletedDocuments: counts[1].count,
      deletedBrands: counts[2].count,
    };

    await this.audit.record(ctx, {
      action: 'tenant.data_deletion',
      resourceType: 'tenant',
      resourceId: tenantId,
      metadata: result as unknown as Record<string, unknown>,
    });
    this.logger.warn(`Data deletion eseguita per tenant ${tenantId}: ${JSON.stringify(result)}`);
    return result;
  }
}

async function safe(fn: () => Promise<unknown>, logger: Logger): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.error(`Pulizia parziale fallita: ${err instanceof Error ? err.message : 'errore'}`);
  }
}
