import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsIn, IsOptional, IsString } from 'class-validator';
import {
  SetVideoTranscript,
  type SetVideoTranscript as SetVideoTranscriptType,
} from '@scorm/contracts';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { GenerationService } from './generation.service.js';
import { MediaService } from './media.service.js';

class GenerateAssessmentDto {
  @IsIn(['intermediate', 'final'])
  scope!: 'intermediate' | 'final';

  @IsOptional()
  @IsString()
  focus?: string;

  /** Modulo di riferimento per i test intermedi (abilita il gating). */
  @IsOptional()
  @IsString()
  moduleId?: string;
}

class GenerateContentDto {
  @IsOptional()
  @IsString()
  toneInstruction?: string;
}

/**
 * API per avviare le fasi di generazione AI (Requisito 4). Richiede ruolo
 * EDITOR. Le fasi sono distinte così che l'outline possa essere revisionato
 * prima di generare i contenuti (human-in-the-loop).
 */
@Controller('courses/:courseId/generate')
@Roles('EDITOR')
export class GenerationController {
  constructor(
    private readonly generation: GenerationService,
    private readonly media: MediaService,
  ) {}

  // Le operazioni testuali del modello sono ASINCRONE: accodano un job e
  // ritornano 202 + { jobId }. Il client fa polling su GET .../jobs/:jobId. Così
  // la request non resta aperta per l'intera durata della chiamata a Bedrock
  // (niente timeout del gateway/LB in produzione).

  @Post('outline')
  @HttpCode(202)
  outline(@CurrentContext() ctx: AuthContext, @Param('courseId') courseId: string) {
    return this.generation.enqueueOutline(ctx, courseId);
  }

  /** Genera i contenuti di TUTTE le lezioni vuote in un unico job server-side. */
  @Post('content/all')
  @HttpCode(202)
  allContent(@CurrentContext() ctx: AuthContext, @Param('courseId') courseId: string) {
    return this.generation.enqueueAllContent(ctx, courseId);
  }

  @Post('lessons/:lessonId/content')
  @HttpCode(202)
  lessonContent(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Body() dto: GenerateContentDto,
  ) {
    return this.generation.enqueueLessonContent(ctx, courseId, lessonId, dto.toneInstruction);
  }

  @Post('assessment')
  @HttpCode(202)
  assessment(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Body() dto: GenerateAssessmentDto,
  ) {
    return this.generation.enqueueAssessment(ctx, courseId, dto.scope, dto.focus ?? '', dto.moduleId);
  }

  /** Genera le immagini mancanti nei block della lezione (placeholder -> reali). */
  @Post('lessons/:lessonId/images')
  generateImages(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Query('force') force?: string,
  ) {
    return this.media.generateLessonImages(ctx.tenant.tenantId, courseId, lessonId, force === 'true');
  }

  /** Genera la narrazione audio (MP3) della lezione dal testo dei block. */
  @Post('lessons/:lessonId/narration')
  generateNarration(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
  ) {
    return this.media.generateLessonNarration(ctx.tenant.tenantId, courseId, lessonId);
  }

  /**
   * Carica un video dell'utente (multipart, campo "file") e lo associa al
   * segnaposto video del block indicato (MP4/WebM, max 100MB).
   */
  @Post('lessons/:lessonId/blocks/:blockId/video')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  uploadVideo(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Param('blockId') blockId: string,
    @UploadedFile() file: { mimetype: string; buffer: Buffer } | undefined,
  ) {
    if (!file) throw new BadRequestException('Nessun file ricevuto (campo "file")');
    return this.media.uploadLessonVideo(ctx.tenant.tenantId, courseId, lessonId, blockId, {
      mimeType: file.mimetype,
      content: file.buffer,
    });
  }

  /**
   * Collega un video della libreria (VideoAsset) al segnaposto video del block
   * indicato, in alternativa all'upload diretto. Copia sorgente e trascrizione.
   */
  @Post('lessons/:lessonId/blocks/:blockId/video/from-library')
  attachVideoFromLibrary(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Param('blockId') blockId: string,
    @Body('videoAssetId') videoAssetId: string | undefined,
  ) {
    if (!videoAssetId) throw new BadRequestException('videoAssetId mancante');
    return this.media.attachVideoAssetToBlock(ctx.tenant.tenantId, courseId, lessonId, blockId, videoAssetId);
  }

  /**
   * Salva (sovrascrive) la trascrizione del block video indicato: inserimento o
   * correzione MANUALE da parte dell'autore, con i tempi reali del video. È il
   * modo affidabile quando non c'è un provider ASR (dev) o per correggere la
   * trascrizione automatica.
   */
  @Put('lessons/:lessonId/blocks/:blockId/transcript')
  setVideoTranscript(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Param('blockId') blockId: string,
    @Body(new ZodValidationPipe(SetVideoTranscript)) dto: SetVideoTranscriptType,
  ) {
    return this.media.setVideoTranscript(ctx.tenant.tenantId, courseId, lessonId, blockId, dto.transcript);
  }

  /** Genera l'immagine di copertina del corso. */
  @Post('cover')
  generateCover(@CurrentContext() ctx: AuthContext, @Param('courseId') courseId: string) {
    return this.media.generateCourseCover(ctx.tenant.tenantId, courseId);
  }

  /** Genera l'immagine di copertina di un modulo. */
  @Post('modules/:moduleId/cover')
  generateModuleCover(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('moduleId') moduleId: string,
  ) {
    return this.media.generateModuleCover(ctx.tenant.tenantId, courseId, moduleId);
  }
}
