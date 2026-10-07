import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { KnowledgeScope as PrismaKnowledgeScope } from '@prisma/client';
import type { JobQueue, ObjectStorage, VectorStore } from '@scorm/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { QuotaService } from '../plans/quota.service.js';
import type { AppConfig } from '../config/configuration.js';
import { JOB_QUEUE, OBJECT_STORAGE, VECTOR_STORE } from '../providers/provider.constants.js';
import { isSupportedMime, SUPPORTED_MIME_LIST } from './supported-formats.js';

export interface UploadInput {
  tenantId: string;
  scope: PrismaKnowledgeScope;
  courseId?: string;
  filename: string;
  mimeType: string;
  content: Buffer;
  /** Correlation id per tracciare l'ingestion asincrona (Requisito 11.2). */
  correlationId?: string;
}

export interface KnowledgeDocView {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  scope: PrismaKnowledgeScope;
  courseId: string | null;
  status: string;
}

/**
 * Gestione della knowledge base (Requisito 3). In questo task copre l'upload:
 * validazione tipo/dimensione, enforcement quota, salvataggio su ObjectStorage
 * e creazione del record KnowledgeDoc in stato PENDING. L'ingestion (chunking,
 * embeddings, indicizzazione) avviene in un job separato (task 3.3).
 */
@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(VECTOR_STORE) private readonly vectors: VectorStore,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
  ) {}

  async upload(input: UploadInput): Promise<KnowledgeDocView> {
    // 1. Validazione formato (Requisito 3.2).
    if (!isSupportedMime(input.mimeType)) {
      throw new BadRequestException(
        `Formato non supportato: ${input.mimeType}. Formati accettati: ${SUPPORTED_MIME_LIST.join(', ')}`,
      );
    }

    // 2. Validazione dimensione del singolo file.
    const maxBytes = this.config.get('upload', { infer: true }).maxFileBytes;
    const sizeBytes = input.content.byteLength;
    if (sizeBytes <= 0) {
      throw new BadRequestException('File vuoto');
    }
    if (sizeBytes > maxBytes) {
      throw new BadRequestException(
        `File troppo grande: ${sizeBytes} byte (max ${maxBytes}).`,
      );
    }

    // 3. Coerenza scope/corso.
    if (input.scope === 'COURSE' && !input.courseId) {
      throw new BadRequestException('courseId obbligatorio per knowledge con scope COURSE');
    }
    if (input.scope === 'COURSE') {
      const course = await this.prisma.course.findFirst({
        where: { id: input.courseId, tenantId: input.tenantId },
        select: { id: true },
      });
      if (!course) throw new NotFoundException('Corso non trovato per il tenant');
    }

    // 4. Quota sulla dimensione totale della knowledge (Requisito 1.5).
    const incrementMb = sizeBytes / (1024 * 1024);
    await this.quota.assertWithinLimit(input.tenantId, 'knowledgeMb', incrementMb);

    // 5. Salvataggio su storage oggetti (file privato).
    const docId = randomUUID();
    const storageKey = this.storageKey(input.tenantId, docId, input.filename);
    await this.storage.putObject(storageKey, input.content, {
      contentType: input.mimeType,
      custom: { tenantId: input.tenantId, documentId: docId },
    });

    // 6. Record KnowledgeDoc in stato PENDING (ingestion asincrona a seguire).
    const doc = await this.prisma.knowledgeDoc.create({
      data: {
        id: docId,
        tenantId: input.tenantId,
        scope: input.scope,
        courseId: input.scope === 'COURSE' ? input.courseId : null,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes,
        storageKey,
        status: 'PENDING',
      },
    });

    // 7. Accoda l'ingestion asincrona (chunking → embeddings → indicizzazione).
    await this.jobs.enqueue(
      'knowledge.ingest',
      { documentId: doc.id },
      {
        tenant: { tenantId: input.tenantId },
        correlationId: input.correlationId ?? randomUUID(),
      },
    );

    return this.toView(doc);
  }

  async list(
    tenantId: string,
    scope?: PrismaKnowledgeScope,
    courseId?: string,
  ): Promise<KnowledgeDocView[]> {
    const docs = await this.prisma.knowledgeDoc.findMany({
      where: { tenantId, scope, courseId },
      orderBy: { createdAt: 'desc' },
    });
    return docs.map((d) => this.toView(d));
  }

  async getDownloadUrl(tenantId: string, docId: string): Promise<string> {
    const doc = await this.prisma.knowledgeDoc.findFirst({
      where: { id: docId, tenantId },
      select: { storageKey: true },
    });
    if (!doc) throw new NotFoundException('Documento non trovato');
    return this.storage.getSignedUrl(doc.storageKey, { expiresInSec: 300 });
  }

  async delete(tenantId: string, docId: string): Promise<void> {
    const doc = await this.prisma.knowledgeDoc.findFirst({
      where: { id: docId, tenantId },
      select: { id: true, storageKey: true },
    });
    if (!doc) throw new NotFoundException('Documento non trovato');

    // Rimuove embeddings (Requisito 3.7), file e record.
    await this.vectors.deleteByDocument({ tenantId }, doc.id);
    await this.storage.deleteObject(doc.storageKey);
    await this.prisma.knowledgeDoc.delete({ where: { id: doc.id } });
  }

  private storageKey(tenantId: string, docId: string, filename: string): string {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `knowledge/${tenantId}/${docId}/${safe}`;
  }

  private toView(doc: {
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    scope: PrismaKnowledgeScope;
    courseId: string | null;
    status: string;
  }): KnowledgeDocView {
    return {
      id: doc.id,
      filename: doc.filename,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      scope: doc.scope,
      courseId: doc.courseId,
      status: doc.status,
    };
  }
}
