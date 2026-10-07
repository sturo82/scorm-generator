import { Controller, Get, Param } from '@nestjs/common';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { ExportService } from './export.service.js';

/**
 * Chunk della knowledge del corso per il widget RAG "Chiedi al corso" in
 * anteprima. È lo STESSO set impacchettato nel pacchetto SCORM (fedeltà 100%).
 */
@Controller('courses/:courseId/rag-chunks')
@Roles('EDITOR')
export class RagChunksController {
  constructor(private readonly exportService: ExportService) {}

  @Get()
  get(@CurrentContext() ctx: AuthContext, @Param('courseId') courseId: string) {
    return this.exportService.getRagChunks(ctx.tenant.tenantId, courseId);
  }

  /**
   * Chunk + embeddings neurali (int8 base64) per la ricerca semantica in
   * anteprima. Stessi vettori del pacchetto SCORM (stesso modello, stesso testo)
   * → coerenza garantita; l'anteprima embedda solo la query a runtime.
   */
  @Get('embeddings')
  embeddings(@CurrentContext() ctx: AuthContext, @Param('courseId') courseId: string) {
    return this.exportService.getRagEmbeddings(ctx.tenant.tenantId, courseId);
  }
}
