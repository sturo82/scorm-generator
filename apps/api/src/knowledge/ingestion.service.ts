import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  DocumentExtractor,
  EmbeddingsProvider,
  ObjectStorage,
  VectorItem,
  VectorStore,
  KnowledgeScope as DomainKnowledgeScope,
} from '@scorm/domain';
import { UnsupportedFormatError } from '@scorm/domain';
import { DocumentExtractorRegistry } from '@scorm/adapters/extractors';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DOCUMENT_EXTRACTORS,
  EMBEDDINGS_PROVIDER,
  OBJECT_STORAGE,
  VECTOR_STORE,
} from '../providers/provider.constants.js';
import { chunkSections } from './chunking.js';

/**
 * Orchestratore dell'ingestion di un documento (Requisito 3.3 / 3.4):
 * scarica il file dallo storage → estrae testo e sezioni → chunking → embeddings
 * → upsert nel vector store con metadati di tenant/scope/documento. Aggiorna lo
 * stato del KnowledgeDoc (PROCESSING → READY | FAILED) in modo osservabile.
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly registry: DocumentExtractorRegistry;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOCUMENT_EXTRACTORS) extractors: DocumentExtractor[],
    @Inject(EMBEDDINGS_PROVIDER) private readonly embeddings: EmbeddingsProvider,
    @Inject(VECTOR_STORE) private readonly vectors: VectorStore,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {
    this.registry = new DocumentExtractorRegistry(extractors);
  }

  /** Esegue l'ingestion di un documento già caricato (record KnowledgeDoc). */
  async ingest(tenantId: string, documentId: string): Promise<void> {
    const doc = await this.prisma.knowledgeDoc.findFirst({
      where: { id: documentId, tenantId },
    });
    if (!doc) throw new Error(`KnowledgeDoc non trovato: ${documentId}`);

    await this.prisma.knowledgeDoc.update({
      where: { id: doc.id },
      data: { status: 'PROCESSING', error: null },
    });

    try {
      if (!this.registry.supports(doc.mimeType)) {
        throw new UnsupportedFormatError(doc.mimeType);
      }

      // 1. Scarica il file sorgente.
      const content = await this.storage.getObject(doc.storageKey);

      // 2. Estrai testo e sezioni.
      const extracted = await this.registry.extract({
        filename: doc.filename,
        mimeType: doc.mimeType,
        content,
      });

      // 3. Chunking semantico con overlap.
      const chunks = chunkSections(extracted.sections);
      if (chunks.length === 0) {
        await this.markReady(doc.id, 0);
        return;
      }

      // 4. Embeddings (batch).
      const vectors = await this.embeddings.embed(chunks.map((c) => c.text));

      // 5. Rimpiazza eventuali embeddings pregressi e inserisce i nuovi.
      await this.vectors.deleteByDocument({ tenantId }, doc.id);
      const scope = doc.scope.toLowerCase() as DomainKnowledgeScope;
      const items: VectorItem[] = chunks.map((chunk, i) => ({
        id: randomUUID(),
        vector: vectors[i] ?? [],
        text: chunk.text,
        documentId: doc.id,
        documentName: doc.filename,
        scope,
        courseId: doc.courseId ?? undefined,
        section: chunk.section,
      }));
      await this.vectors.upsert({ tenantId }, items);

      await this.markReady(doc.id, items.length);
      this.logger.log(`Ingestion completata per ${doc.id}: ${items.length} chunk`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Errore sconosciuto';
      await this.prisma.knowledgeDoc.update({
        where: { id: doc.id },
        data: { status: 'FAILED', error: message },
      });
      this.logger.error(`Ingestion fallita per ${doc.id}: ${message}`);
      throw err;
    }
  }

  private async markReady(docId: string, _chunkCount: number): Promise<void> {
    await this.prisma.knowledgeDoc.update({
      where: { id: docId },
      data: { status: 'READY', error: null },
    });
  }
}
