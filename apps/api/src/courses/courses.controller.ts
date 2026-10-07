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
  Brief,
  BriefDraft,
  Block,
  Question,
  MoveCourse,
  type Brief as BriefType,
  type BriefDraft as BriefDraftType,
  type Block as BlockType,
  type Question as QuestionType,
  type MoveCourse as MoveCourseType,
} from '@scorm/contracts';
import { z } from 'zod';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CoursesService } from './courses.service.js';
import { ModulesService } from './modules.service.js';
import { FoldersService } from './folders.service.js';
import {
  CreateAssessmentDto,
  CreateCourseDto,
  CreateLessonDto,
  CreateModuleDto,
  UpdateCourseSettingsDto,
} from './dto.js';

const BlockArraySchema = z.array(Block);
const StringArraySchema = z.array(z.string());
const VideoFirstSchema = z.object({ videoFirst: z.boolean() });

/**
 * API di gestione corso, brief e gerarchia contenuti (Requisito 2 / 4.2).
 * Le operazioni di scrittura richiedono ruolo EDITOR o superiore.
 */
@Controller('courses')
export class CoursesController {
  constructor(
    private readonly courses: CoursesService,
    private readonly modules: ModulesService,
    private readonly folders: FoldersService,
  ) {}

  // --- Corso ----------------------------------------------------------------

  @Post()
  @Roles('EDITOR')
  create(@CurrentContext() ctx: AuthContext, @Body() dto: CreateCourseDto) {
    return this.courses.create({ tenantId: ctx.tenant.tenantId, ...dto });
  }

  @Get()
  list(
    @CurrentContext() ctx: AuthContext,
    @Query('folderId') folderId?: string,
    @Query('q') q?: string,
  ) {
    // folderId='root' filtra la radice; una stringa filtra quella cartella;
    // assente = tutti. La ricerca `q` è trasversale alle cartelle.
    return this.courses.list(ctx.tenant.tenantId, { folderId, q });
  }

  /** Sposta il corso in una cartella (folderId null = radice). */
  @Put(':id/folder')
  @Roles('EDITOR')
  async moveToFolder(
    @CurrentContext() ctx: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MoveCourse)) dto: MoveCourseType,
  ) {
    await this.folders.moveCourse(ctx.tenant.tenantId, id, dto.folderId);
    return { moved: true };
  }

  @Get(':id')
  get(@CurrentContext() ctx: AuthContext, @Param('id') id: string) {
    return this.courses.get(ctx.tenant.tenantId, id);
  }

  @Delete(':id')
  @Roles('EDITOR')
  async remove(@CurrentContext() ctx: AuthContext, @Param('id') id: string) {
    await this.courses.delete(ctx.tenant.tenantId, id);
    return { deleted: true };
  }

  /** Impostazioni di presentazione del corso (es. stile micro-interazioni). */
  @Put(':id/settings')
  @Roles('EDITOR')
  updateSettings(
    @CurrentContext() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateCourseSettingsDto,
  ) {
    return this.courses.updateSettings(ctx.tenant.tenantId, id, dto);
  }

  /** Carica la foto del docente (multipart, campo "file"). */
  @Post(':id/instructor/avatar')
  @Roles('EDITOR')
  @UseInterceptors(FileInterceptor('file'))
  uploadInstructorAvatar(
    @CurrentContext() ctx: AuthContext,
    @Param('id') id: string,
    @UploadedFile() file: { mimetype: string; buffer: Buffer } | undefined,
  ) {
    if (!file) throw new BadRequestException('Nessun file ricevuto (campo "file")');
    return this.courses.uploadInstructorAvatar(ctx.tenant.tenantId, id, {
      mimeType: file.mimetype,
      content: file.buffer,
    });
  }

  // --- Brief ----------------------------------------------------------------

  @Put(':id/brief/draft')
  @Roles('EDITOR')
  saveBriefDraft(
    @CurrentContext() ctx: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(BriefDraft)) draft: BriefDraftType,
  ) {
    return this.courses.saveBriefDraft(ctx.tenant.tenantId, id, draft);
  }

  @Put(':id/brief')
  @Roles('EDITOR')
  saveBrief(
    @CurrentContext() ctx: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(Brief)) brief: BriefType,
  ) {
    return this.courses.saveBrief(ctx.tenant.tenantId, id, brief);
  }

  // --- Moduli / Lezioni -----------------------------------------------------

  @Post(':id/modules')
  @Roles('EDITOR')
  addModule(
    @CurrentContext() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: CreateModuleDto,
  ) {
    return this.modules.addModule(ctx.tenant.tenantId, id, dto);
  }

  @Get(':id/modules')
  listModules(@CurrentContext() ctx: AuthContext, @Param('id') id: string) {
    return this.modules.listModules(ctx.tenant.tenantId, id);
  }

  /** Materializza l'outline generato dall'AI in moduli/lezioni (idempotente). */
  @Post(':id/outline/apply')
  @Roles('EDITOR')
  applyOutline(@CurrentContext() ctx: AuthContext, @Param('id') id: string) {
    return this.modules.materializeOutline(ctx.tenant.tenantId, id);
  }

  @Delete(':id/modules/:moduleId')
  @Roles('EDITOR')
  removeModule(
    @CurrentContext() ctx: AuthContext,
    @Param('id') id: string,
    @Param('moduleId') moduleId: string,
  ) {
    return this.modules.deleteModule(ctx.tenant.tenantId, id, moduleId);
  }

  @Delete(':id/modules/:moduleId/lessons/:lessonId')
  @Roles('EDITOR')
  removeLesson(
    @CurrentContext() ctx: AuthContext,
    @Param('id') id: string,
    @Param('moduleId') moduleId: string,
    @Param('lessonId') lessonId: string,
  ) {
    return this.modules.deleteLesson(ctx.tenant.tenantId, id, moduleId, lessonId);
  }

  @Post(':id/modules/:moduleId/lessons')
  @Roles('EDITOR')
  addLesson(
    @CurrentContext() ctx: AuthContext,
    @Param('id') id: string,
    @Param('moduleId') moduleId: string,
    @Body() dto: CreateLessonDto,
  ) {
    return this.modules.addLesson(ctx.tenant.tenantId, id, moduleId, dto);
  }

  @Put(':id/modules/:moduleId/lessons/:lessonId/blocks')
  @Roles('EDITOR')
  setLessonBlocks(
    @CurrentContext() ctx: AuthContext,
    @Param('id') id: string,
    @Param('moduleId') moduleId: string,
    @Param('lessonId') lessonId: string,
    @Body(new ZodValidationPipe(BlockArraySchema)) blocks: BlockType[],
  ) {
    return this.modules.setLessonBlocks(ctx.tenant.tenantId, id, moduleId, lessonId, blocks);
  }

  @Put(':id/modules/:moduleId/lessons/:lessonId/objectives')
  @Roles('EDITOR')
  setLessonObjectives(
    @CurrentContext() ctx: AuthContext,
    @Param('id') id: string,
    @Param('moduleId') moduleId: string,
    @Param('lessonId') lessonId: string,
    @Body(new ZodValidationPipe(StringArraySchema)) objectives: string[],
  ) {
    return this.modules.setLessonObjectives(ctx.tenant.tenantId, id, moduleId, lessonId, objectives);
  }

  /** Marca/smarca una lezione come video-first (incentrata su un video). */
  @Put(':id/modules/:moduleId/lessons/:lessonId/video-first')
  @Roles('EDITOR')
  setLessonVideoFirst(
    @CurrentContext() ctx: AuthContext,
    @Param('id') id: string,
    @Param('moduleId') moduleId: string,
    @Param('lessonId') lessonId: string,
    @Body(new ZodValidationPipe(VideoFirstSchema)) body: { videoFirst: boolean },
  ) {
    return this.modules.setLessonVideoFirst(ctx.tenant.tenantId, id, moduleId, lessonId, body.videoFirst);
  }

  // --- Assessment / Domande -------------------------------------------------

  /** Elenco leggero degli assessment del corso (per l'indice dell'anteprima). */
  @Get(':id/assessments')
  listAssessments(@CurrentContext() ctx: AuthContext, @Param('id') id: string) {
    return this.modules.listAssessments(ctx.tenant.tenantId, id);
  }

  @Post(':id/assessments')
  @Roles('EDITOR')
  addAssessment(
    @CurrentContext() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: CreateAssessmentDto,
  ) {
    return this.modules.addAssessment(ctx.tenant.tenantId, id, dto);
  }

  @Post(':id/assessments/:assessmentId/questions')
  @Roles('EDITOR')
  addQuestion(
    @CurrentContext() ctx: AuthContext,
    @Param('id') id: string,
    @Param('assessmentId') assessmentId: string,
    @Body(new ZodValidationPipe(Question)) question: QuestionType,
  ) {
    return this.modules.addQuestion(ctx.tenant.tenantId, id, assessmentId, question);
  }
}
