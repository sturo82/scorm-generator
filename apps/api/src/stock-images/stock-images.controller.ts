import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  AttachStockImageInput,
  type AttachStockImageInput as AttachStockImageInputType,
  AttachStockCoverInput,
  type AttachStockCoverInput as AttachStockCoverInputType,
} from '@scorm/contracts';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { StockImagesService } from './stock-images.service.js';

/** Tipi immagine ammessi per l'upload da PC. */
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/**
 * Libreria immagini stock (royalty-free). Ricerca (proxy verso il provider) e
 * collegamento di un'immagine scelta a un block. Richiede ruolo EDITOR.
 */
@Controller('courses/:courseId/stock-images')
@Roles('EDITOR')
export class StockImagesController {
  constructor(private readonly stock: StockImagesService) {}

  @Get('search')
  search(@Query('q') q: string) {
    return this.stock.search(q ?? '');
  }

  @Post('lessons/:lessonId/attach')
  attach(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Body(new ZodValidationPipe(AttachStockImageInput)) input: AttachStockImageInputType,
  ) {
    return this.stock.attachToBlock(ctx.tenant.tenantId, courseId, lessonId, {
      blockId: input.blockId,
      photoId: input.photoId,
      mediaIndex: input.mediaIndex,
      alt: input.alt,
    });
  }

  /**
   * Carica un'immagine dal PC dell'utente (multipart, campo "file") e la collega
   * al MediaRef immagine del block indicato. blockId/mediaIndex/alt via query o
   * form field. Max 8MB; PNG/JPEG/WebP/GIF. Non richiede provider stock.
   */
  @Post('lessons/:lessonId/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  uploadToBlock(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @UploadedFile() file: { mimetype: string; buffer: Buffer } | undefined,
    @Body('blockId') blockId?: string,
    @Body('mediaIndex') mediaIndex?: string,
    @Body('alt') alt?: string,
  ) {
    if (!file) throw new BadRequestException('Nessun file ricevuto (campo "file")');
    if (!blockId) throw new BadRequestException('blockId mancante');
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Formato non supportato: usa PNG, JPEG, WebP o GIF');
    }
    const idx = mediaIndex != null && mediaIndex !== '' ? Number(mediaIndex) : undefined;
    return this.stock.attachUploadToBlock(ctx.tenant.tenantId, courseId, lessonId, {
      blockId,
      bytes: file.buffer,
      contentType: file.mimetype,
      mediaIndex: Number.isFinite(idx) ? idx : undefined,
      alt,
    });
  }

  /** Imposta un'immagine stock come copertina del corso. */
  @Post('cover')
  attachCover(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Body(new ZodValidationPipe(AttachStockCoverInput)) input: AttachStockCoverInputType,
  ) {
    return this.stock.attachCover(ctx.tenant.tenantId, courseId, { photoId: input.photoId });
  }

  /** Imposta un'immagine stock come copertina di un modulo. */
  @Post('modules/:moduleId/cover')
  attachModuleCover(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('moduleId') moduleId: string,
    @Body(new ZodValidationPipe(AttachStockCoverInput)) input: AttachStockCoverInputType,
  ) {
    return this.stock.attachModuleCover(ctx.tenant.tenantId, courseId, moduleId, {
      photoId: input.photoId,
    });
  }
}
