import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { KnowledgeService, type KnowledgeDocView } from './knowledge.service.js';

/** File caricato da multer (sottoinsieme usato). */
interface UploadedMulterFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

/**
 * API della knowledge base. L'upload richiede ruolo EDITOR o superiore
 * (Requisito 1.3); la lettura è consentita a chiunque sia autenticato.
 */
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Post('upload')
  @Roles('EDITOR')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentContext() ctx: AuthContext,
    @UploadedFile() file: UploadedMulterFile | undefined,
    @Query('scope') scope?: string,
    @Query('courseId') courseId?: string,
  ): Promise<KnowledgeDocView> {
    if (!file) throw new BadRequestException('Nessun file ricevuto (campo "file")');
    const normalizedScope = (scope ?? 'GLOBAL').toUpperCase();
    if (normalizedScope !== 'GLOBAL' && normalizedScope !== 'COURSE') {
      throw new BadRequestException('scope deve essere GLOBAL o COURSE');
    }

    return this.knowledge.upload({
      tenantId: ctx.tenant.tenantId,
      scope: normalizedScope,
      courseId,
      filename: file.originalname,
      mimeType: file.mimetype,
      content: file.buffer,
      correlationId: ctx.correlationId,
    });
  }

  @Get()
  async list(
    @CurrentContext() ctx: AuthContext,
    @Query('scope') scope?: string,
    @Query('courseId') courseId?: string,
  ): Promise<KnowledgeDocView[]> {
    const normalizedScope =
      scope?.toUpperCase() === 'GLOBAL' || scope?.toUpperCase() === 'COURSE'
        ? (scope.toUpperCase() as 'GLOBAL' | 'COURSE')
        : undefined;
    return this.knowledge.list(ctx.tenant.tenantId, normalizedScope, courseId);
  }

  @Get(':id/download-url')
  async downloadUrl(
    @CurrentContext() ctx: AuthContext,
    @Param('id') id: string,
  ): Promise<{ url: string }> {
    const url = await this.knowledge.getDownloadUrl(ctx.tenant.tenantId, id);
    return { url };
  }

  @Delete(':id')
  @Roles('EDITOR')
  async remove(
    @CurrentContext() ctx: AuthContext,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    await this.knowledge.delete(ctx.tenant.tenantId, id);
    return { deleted: true };
  }
}
