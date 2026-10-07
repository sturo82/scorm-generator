import { Module } from '@nestjs/common';
import { ExportService } from './export.service.js';
import { ExportController } from './export.controller.js';
import { RagChunksController } from './rag-chunks.controller.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';

@Module({
  imports: [KnowledgeModule],
  controllers: [ExportController, RagChunksController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
