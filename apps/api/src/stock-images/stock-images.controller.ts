import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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
