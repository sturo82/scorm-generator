import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  StartSlideClips as StartSlideClipsSchema,
  UpdateSlideScripts as UpdateSlideScriptsSchema,
  type StartSlideClips as StartSlideClipsType,
  type UpdateSlideScripts as UpdateSlideScriptsType,
} from '@scorm/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SlideClipsService, type SlideClipsEstimate, type SlideClipsView } from './slide-clips.service.js';
import { SlideScriptsService, type SlideScriptsDoc } from './slide-scripts.service.js';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { SLIDES_MAX_PDF_BYTES, SlidesService, type SlideImportView } from './slides.service.js';

interface UploadedMulterFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

/** Importazione di slide da PDF per i video-lezione "slide + avatar". */
@Controller('courses/:courseId/slides')
export class SlidesController {
  constructor(
    private readonly slides: SlidesService,
    private readonly scripts: SlideScriptsService,
    private readonly clips: SlideClipsService,
  ) {}

  @Post('import')
  @Roles('EDITOR')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: SLIDES_MAX_PDF_BYTES } }))
  async import(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @UploadedFile() file: UploadedMulterFile | undefined,
  ): Promise<SlideImportView> {
    if (!file) throw new BadRequestException('Nessun file ricevuto (campo "file")');
    if (file.mimetype !== 'application/pdf') throw new BadRequestException('Serve un file PDF');
    return this.slides.importPdf({
      tenantId: ctx.tenant.tenantId,
      courseId,
      filename: file.originalname,
      content: file.buffer,
    });
  }

  @Get('imports/:importId/scripts')
  async getScripts(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
  ): Promise<SlideScriptsDoc | { status: 'none' }> {
    return (await this.scripts.get(ctx.tenant.tenantId, courseId, importId)) ?? { status: 'none' };
  }

  @Post('imports/:importId/scripts/generate')
  @Roles('EDITOR')
  generateScripts(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
  ): Promise<SlideScriptsDoc> {
    return this.scripts.generate(ctx.tenant.tenantId, courseId, importId);
  }

  @Put('imports/:importId/scripts')
  @Roles('EDITOR')
  updateScripts(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
    @Body(new ZodValidationPipe(UpdateSlideScriptsSchema)) body: UpdateSlideScriptsType,
  ): Promise<SlideScriptsDoc> {
    return this.scripts.update(ctx.tenant.tenantId, courseId, importId, body);
  }

  @Get('imports/:importId/clips/estimate')
  estimateClips(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
    @Query('engine') engine?: string,
    @Query('avatarType') avatarType?: string,
  ): Promise<SlideClipsEstimate> {
    const type = avatarType === 'photo' || avatarType === 'studio' ? avatarType : 'digital_twin';
    return this.clips.estimate(ctx.tenant.tenantId, courseId, importId, engine, type);
  }

  @Get('imports/:importId/clips')
  async getClips(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
  ): Promise<SlideClipsView | { status: 'none' }> {
    return (await this.clips.status(ctx.tenant.tenantId, courseId, importId)) ?? { status: 'none' };
  }

  /** Avvia o riprende la generazione delle clip avatar (a copioni approvati). */
  @Post('imports/:importId/clips')
  @Roles('EDITOR')
  startClips(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
    @Body(new ZodValidationPipe(StartSlideClipsSchema)) body: StartSlideClipsType,
  ): Promise<SlideClipsView> {
    return this.clips.start(ctx.tenant.tenantId, courseId, importId, body);
  }

  @Get('imports/:importId')
  get(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
  ): Promise<SlideImportView> {
    return this.slides.get(ctx.tenant.tenantId, courseId, importId);
  }
}
