import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { z } from 'zod';
import { Block, type Block as BlockType } from '@scorm/contracts';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { EditorialService, type EntityType } from './editorial.service.js';
import { GenerationService } from '../generation/generation.service.js';

const EditBlocksSchema = z.object({
  blocks: z.array(Block),
  expectedUpdatedAt: z.string(),
});

class SetStatusDto {
  @IsIn(['DRAFT', 'IN_REVIEW', 'APPROVED'])
  status!: 'DRAFT' | 'IN_REVIEW' | 'APPROVED';
}

class RegenerateDto {
  @IsOptional()
  @IsString()
  toneInstruction?: string;
}

/**
 * API dell'editor human-in-the-loop (Requisito 8). Scrittura: ruolo EDITOR.
 */
@Controller('courses/:courseId')
@Roles('EDITOR')
export class EditorialController {
  constructor(
    private readonly editorial: EditorialService,
    private readonly generation: GenerationService,
  ) {}

  @Put('lessons/:lessonId/blocks')
  editBlocks(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Body(new ZodValidationPipe(EditBlocksSchema)) body: { blocks: BlockType[]; expectedUpdatedAt: string },
  ) {
    return this.editorial.editLessonBlocks(ctx.tenant.tenantId, courseId, lessonId, {
      blocks: body.blocks,
      expectedUpdatedAt: body.expectedUpdatedAt,
      authorId: ctx.userId,
    });
  }

  @Put(':entity/:entityId/status')
  setStatus(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('entity') entity: EntityType,
    @Param('entityId') entityId: string,
    @Body() dto: SetStatusDto,
  ) {
    return this.editorial.setStatus(ctx.tenant.tenantId, courseId, entity, entityId, dto.status);
  }

  /**
   * Applica uno stato (default APPROVED) in blocco a tutte le entità del corso
   * (moduli, lezioni, assessment e corso). Comodo per i corsi grandi.
   */
  @Put('status/all')
  setStatusAll(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Body() dto: SetStatusDto,
  ) {
    return this.editorial.setStatusAll(ctx.tenant.tenantId, courseId, dto.status);
  }

  @Get('versions/:entity/:entityId')
  listVersions(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('entity') entity: EntityType,
    @Param('entityId') entityId: string,
  ) {
    return this.editorial.listVersions(ctx.tenant.tenantId, courseId, entity, entityId);
  }

  @Get('versions/by-id/:versionId')
  getVersion(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.editorial.getVersion(ctx.tenant.tenantId, courseId, versionId);
  }

  @Post('lessons/:lessonId/restore/:versionId')
  restore(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.editorial.restoreLessonVersion(
      ctx.tenant.tenantId,
      courseId,
      lessonId,
      versionId,
      ctx.userId,
    );
  }

  /**
   * Rigenerazione mirata di una lezione (Requisito 8.4): salva la versione
   * corrente e rigenera i contenuti, opzionalmente con un'istruzione di tono.
   */
  @Post('lessons/:lessonId/regenerate')
  async regenerate(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Body() dto: RegenerateDto,
  ) {
    await this.editorial.snapshotLessonBeforeRegeneration(
      ctx.tenant.tenantId,
      courseId,
      lessonId,
      ctx.userId,
    );
    // Rigenerazione asincrona: ritorna { jobId } per il polling (coerente con
    // gli altri endpoint di generazione, niente timeout sincrono).
    return this.generation.enqueueLessonContent(ctx, courseId, lessonId, dto.toneInstruction);
  }
}
