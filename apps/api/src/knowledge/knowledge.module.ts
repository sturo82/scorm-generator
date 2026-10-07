import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import type { JobEnvelope, JobQueue } from '@scorm/domain';
import { JOB_QUEUE } from '../providers/provider.constants.js';
import { KnowledgeService } from './knowledge.service.js';
import { KnowledgeController } from './knowledge.controller.js';
import { IngestionService } from './ingestion.service.js';
import { RetrievalService } from './retrieval.service.js';

export interface IngestJobPayload {
  documentId: string;
}

/**
 * Modulo della knowledge base. Registra l'handler del job di ingestion
 * (knowledge.ingest) sulla coda, così l'upload accoda l'elaborazione asincrona
 * (chunking → embeddings → indicizzazione).
 */
@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService, IngestionService, RetrievalService],
  exports: [KnowledgeService, IngestionService, RetrievalService],
})
export class KnowledgeModule implements OnModuleInit {
  constructor(
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    private readonly ingestion: IngestionService,
  ) {}

  onModuleInit(): void {
    this.jobs.register<IngestJobPayload>('knowledge.ingest', async (job: JobEnvelope<IngestJobPayload>) => {
      await this.ingestion.ingest(job.context.tenant.tenantId, job.payload.documentId);
    });
  }
}
