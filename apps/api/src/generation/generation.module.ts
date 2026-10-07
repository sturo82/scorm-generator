import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import type { JobEnvelope, JobQueue } from '@scorm/domain';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { CoursesModule } from '../courses/courses.module.js';
import { JOB_QUEUE } from '../providers/provider.constants.js';
import {
  GenerationService,
  type GenJobType,
  type GenJobPayload,
} from './generation.service.js';
import { MediaService } from './media.service.js';
import { GenerationController } from './generation.controller.js';
import { JobsController } from './jobs.controller.js';
import { ActiveJobsController } from './active-jobs.controller.js';

/**
 * Modulo di generazione AI. Importa KnowledgeModule per il RetrievalService
 * (RAG) e CoursesModule per ModulesService (materializzazione outline). I
 * provider (LLM, immagini, audio, storage, coda) sono risolti dal container
 * globale. Registra gli handler dei job di generazione sulla coda: così gli
 * endpoint accodano e il worker esegue il modello fuori dalla request HTTP.
 */
@Module({
  imports: [KnowledgeModule, CoursesModule],
  controllers: [GenerationController, JobsController, ActiveJobsController],
  providers: [GenerationService, MediaService],
  exports: [GenerationService, MediaService],
})
export class GenerationModule implements OnModuleInit {
  constructor(
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    private readonly generation: GenerationService,
  ) {}

  onModuleInit(): void {
    const types: GenJobType[] = [
      'course.generate_outline',
      'course.generate_content',
      'course.generate_all_content',
      'course.generate_assessment',
    ];
    for (const type of types) {
      this.jobs.register<GenJobPayload & { jobId: string }>(
        type,
        async (job: JobEnvelope<GenJobPayload & { jobId: string }>) => {
          await this.generation.handleJob({ ...job.payload, type }, job.context);
        },
      );
    }
    // Recupero job orfani lasciati da un riavvio: non blocca il bootstrap.
    void this.generation.recoverStaleJobs().catch(() => undefined);
  }
}
