import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  CreateExternalVideo,
  UpdateVideoAsset,
  type CreateExternalVideo as CreateExternalVideoType,
  type UpdateVideoAsset as UpdateVideoAssetType,
} from '@scorm/contracts';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { VideosService } from './videos.service.js';

/**
 * API della libreria video per-tenant: lista (filtrabile per sorgente/canale),
 * upload di file, registrazione di video esterni (YouTube/Vimeo/Twitch), update
 * ed eliminazione. Lettura per tutti gli utenti del tenant; scrittura EDITOR.
 */
@Controller('videos')
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  @Get()
  list(
    @CurrentContext() ctx: AuthContext,
    @Query('source') source?: string,
    @Query('channel') channel?: string,
  ) {
    const src = source as 'upload' | 'youtube' | 'vimeo' | 'twitch' | undefined;
    return this.videos.list(ctx.tenant.tenantId, { source: src, channel });
  }

  @Get('channels')
  channels(@CurrentContext() ctx: AuthContext) {
    return this.videos.channels(ctx.tenant.tenantId);
  }

  @Get(':id')
  get(@CurrentContext() ctx: AuthContext, @Param('id') id: string) {
    return this.videos.get(ctx.tenant.tenantId, id);
  }

  /** Registra un video esterno (YouTube/Vimeo/Twitch) nella libreria. */
  @Post('external')
  @Roles('EDITOR')
  createExternal(
    @CurrentContext() ctx: AuthContext,
    @Body(new ZodValidationPipe(CreateExternalVideo)) dto: CreateExternalVideoType,
  ) {
    return this.videos.createExternal(ctx.tenant.tenantId, dto);
  }

  /** Upload di un file video (multipart, campo "file"). */
  @Post('upload')
  @Roles('EDITOR')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }))
  upload(
    @CurrentContext() ctx: AuthContext,
    @UploadedFile() file: { mimetype: string; buffer: Buffer; originalname?: string } | undefined,
    @Body('title') title?: string,
    @Body('channel') channel?: string,
  ) {
    if (!file) throw new BadRequestException('Nessun file ricevuto (campo "file")');
    return this.videos.uploadVideo(
      ctx.tenant.tenantId,
      { mimeType: file.mimetype, content: file.buffer, filename: file.originalname },
      { title, channel },
    );
  }

  @Put(':id')
  @Roles('EDITOR')
  update(
    @CurrentContext() ctx: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateVideoAsset)) dto: UpdateVideoAssetType,
  ) {
    return this.videos.update(ctx.tenant.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('EDITOR')
  async remove(@CurrentContext() ctx: AuthContext, @Param('id') id: string) {
    await this.videos.delete(ctx.tenant.tenantId, id);
    return { deleted: true };
  }
}
