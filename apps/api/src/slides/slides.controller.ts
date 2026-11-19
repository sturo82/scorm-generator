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
  BuildSlideLesson as BuildSlideLessonSchema,
  GenerateSlideScripts as GenerateSlideScriptsSchema,
  RemasterSlideLesson as RemasterSlideLessonSchema,
  StartSlideClips as StartSlideClipsSchema,
  UpdateSlideGlossary,
  UpdateSlideScripts as UpdateSlideScriptsSchema,
  type BuildSlideLesson as BuildSlideLessonType,
  type StartSlideClips as StartSlideClipsType,
  type UpdateSlideGlossary as UpdateSlideGlossaryType,
  type UpdateSlideScripts as UpdateSlideScriptsType,
} from '@scorm/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SlideLessonService, type SectionInput, type SlideLessonView } from './slide-lesson.service.js';
import { SlideClipsService, type SlideClipsEstimate, type SlideClipsView } from './slide-clips.service.js';
import { SlideScriptsService, type ScriptsGenerationState, type SlideScriptsDoc } from './slide-scripts.service.js';
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
    private readonly lessons: SlideLessonService,
  ) {}

  @Post('import')
  @Roles('EDITOR')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: SLIDES_MAX_PDF_BYTES } }))
  async import(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @UploadedFile() file: UploadedMulterFile | undefined,
    @Query('language') language?: string,
  ): Promise<SlideImportView> {
    if (!file) throw new BadRequestException('Nessun file ricevuto (campo "file")');
    if (file.mimetype !== 'application/pdf') throw new BadRequestException('Serve un file PDF');
    return this.slides.importPdf({
      tenantId: ctx.tenant.tenantId,
      courseId,
      filename: file.originalname,
      content: file.buffer,
      language,
    });
  }

  /** Copioni correnti (o `status: 'none'`) con lo stato dell'eventuale generazione in background. */
  @Get('imports/:importId/scripts')
  async getScripts(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
  ): Promise<(SlideScriptsDoc | { status: 'none' }) & { generation?: ScriptsGenerationState }> {
    const [doc, generation] = await Promise.all([
      this.scripts.get(ctx.tenant.tenantId, courseId, importId),
      this.scripts.generationState(ctx.tenant.tenantId, courseId, importId),
    ]);
    const base = doc ?? { status: 'none' as const };
    return generation ? { ...base, generation } : base;
  }

  @Post('imports/:importId/scripts/generate')
  @Roles('EDITOR')
  generateScripts(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
    @Body() raw: unknown,
  ): Promise<ScriptsGenerationState> {
    // Il body è opzionale (compatibilità con chi non passa la knowledge).
    const parsed = GenerateSlideScriptsSchema.safeParse(raw ?? {});
    if (!parsed.success) throw new BadRequestException('Richiesta non valida: knowledgeDocIds');
    // Parte in background e ritorna subito: il client interroga GET .../scripts.
    return this.scripts.startGenerate(ctx.tenant.tenantId, courseId, importId, parsed.data);
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

  /** Glossario di pronuncia (nomi e sigle). Modificabile anche a copioni approvati. */
  @Put('imports/:importId/glossary')
  @Roles('EDITOR')
  setGlossary(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
    @Body(new ZodValidationPipe(UpdateSlideGlossary)) body: UpdateSlideGlossaryType,
  ): Promise<SlideScriptsDoc> {
    return this.scripts.setGlossary(ctx.tenant.tenantId, courseId, importId, body.glossary);
  }

  /** Preventivo massimo del video prima dei copioni (solo slide / con knowledge). */
  @Get('imports/:importId/estimate')
  estimateImport(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
    @Query('engine') engine?: string,
    @Query('avatarType') avatarType?: string,
    @Query('sections') sections?: string,
  ) {
    const type = avatarType === 'digital_twin' || avatarType === 'studio' ? avatarType : 'photo';
    return this.lessons.estimateImport(ctx.tenant.tenantId, courseId, importId, { engine, avatarType: type, sections: sections === 'true' });
  }
  @Get('imports/:importId/clips/estimate')
  estimateClips(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
    @Query('engine') engine?: string,
    @Query('avatarType') avatarType?: string,
    @Query('all') all?: string,
  ): Promise<SlideClipsEstimate> {
    const type = avatarType === 'photo' || avatarType === 'studio' ? avatarType : 'digital_twin';
    return this.clips.estimate(ctx.tenant.tenantId, courseId, importId, engine, type, all === 'true');
  }

  /** Cambia avatar: rigenera tutte le clip con il nuovo avatar (copioni, slide e regia restano). */
  @Post('imports/:importId/clips/avatar')
  @Roles('EDITOR')
  changeAvatar(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
    @Body(new ZodValidationPipe(StartSlideClipsSchema)) body: StartSlideClipsType,
  ): Promise<SlideClipsView> {
    return this.clips.changeAvatar(ctx.tenant.tenantId, courseId, importId, body);
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

  /** Propone la divisione in sezioni (titoli e slide di inizio), modificabile dall'utente. */
  @Post('imports/:importId/sections/propose')
  @Roles('EDITOR')
  async proposeSections(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
  ): Promise<{ sections: SectionInput[] }> {
    return { sections: await this.lessons.proposeSections(ctx.tenant.tenantId, courseId, importId) };
  }

  /** Sostituisce le immagini con quelle di un PDF aggiornato, mantenendo copioni e clip. */
  @Post('imports/:importId/replace')
  @Roles('EDITOR')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: SLIDES_MAX_PDF_BYTES } }))
  async replace(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
    @UploadedFile() file: UploadedMulterFile | undefined,
  ): Promise<SlideImportView & { warnings: string[] }> {
    if (!file) throw new BadRequestException('Nessun file ricevuto (campo "file")');
    if (file.mimetype !== 'application/pdf') throw new BadRequestException('Serve un file PDF');
    return this.slides.replacePdf({
      tenantId: ctx.tenant.tenantId,
      courseId,
      importId,
      filename: file.originalname,
      content: file.buffer,
    });
  }

  /** Rifà i video delle lezioni con le slide aggiornate, senza rigenerare le clip avatar. */
  @Post('imports/:importId/lesson/remaster')
  @Roles('EDITOR')
  remasterLesson(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
    @Body() raw: unknown,
  ): Promise<SlideLessonView> {
    // Body opzionale: senza scelte si rimonta con disposizione e posizioni attuali.
    const parsed = RemasterSlideLessonSchema.safeParse(raw ?? {});
    if (!parsed.success) throw new BadRequestException('Richiesta non valida: disposizione o posizioni');
    return this.lessons.remaster(ctx.tenant.tenantId, courseId, importId, parsed.data);
  }

  /** Regia automatica (inquadratura e angolo dell'avatar per slide) del layout dinamico. */
  @Get('imports/:importId/lesson/direction')
  async lessonDirection(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
  ): Promise<{ items: Array<{ index: number; shot: string; corner: string; words: number }> }> {
    return { items: await this.lessons.direction(ctx.tenant.tenantId, courseId, importId) };
  }

  @Get('imports/:importId/lesson')
  async getLesson(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
  ): Promise<SlideLessonView | { status: 'none' }> {
    return (await this.lessons.status(ctx.tenant.tenantId, courseId, importId)) ?? { status: 'none' };
  }

  /** Monta il video e crea modulo + lezione video-first con riepilogo e quiz. */
  @Post('imports/:importId/lesson')
  @Roles('EDITOR')
  buildLesson(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
    @Body(new ZodValidationPipe(BuildSlideLessonSchema)) body: BuildSlideLessonType,
  ): Promise<SlideLessonView> {
    return this.lessons.start(ctx.tenant.tenantId, courseId, importId, body);
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
