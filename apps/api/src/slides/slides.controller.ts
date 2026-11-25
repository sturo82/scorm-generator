import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Put,
  Req,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import {
  BuildSlideLesson as BuildSlideLessonSchema,
  GenerateSlideScripts as GenerateSlideScriptsSchema,
  RemasterSlideLesson as RemasterSlideLessonSchema,
  StartSlideClips as StartSlideClipsSchema,
  UpdateSlideGlossary,
  UpdateSlideScripts as UpdateSlideScriptsSchema,
  UpdateVideoImport as UpdateVideoImportSchema,
  VIDEO_SCRIPT,
  type UpdateVideoImport as UpdateVideoImportType,
  type BuildSlideLesson as BuildSlideLessonType,
  type StartSlideClips as StartSlideClipsType,
  type UpdateSlideGlossary as UpdateSlideGlossaryType,
  type UpdateSlideScripts as UpdateSlideScriptsType,
} from '@scorm/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SlideLessonService, type SectionInput, type SlideLessonView } from './slide-lesson.service.js';
import { AvatarAccessService } from '../generation/avatar-access.service.js';
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
    private readonly avatarAccess: AvatarAccessService,
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

  /** Crea un import "da video" vuoto; i video si aggiungono uno alla volta. */
  @Post('video-imports')
  @Roles('EDITOR')
  createVideoImport(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Body() body: { title?: string; language?: string },
  ): Promise<SlideImportView> {
    return this.slides.createVideoImport({
      tenantId: ctx.tenant.tenantId,
      courseId,
      title: typeof body?.title === 'string' ? body.title : undefined,
      language: typeof body?.language === 'string' ? body.language : undefined,
    });
  }

  /** Aggiunge un video (multipart: "file", "poster", "frames" e il campo "durationSec"). */
  @Post('imports/:importId/videos')
  @Roles('EDITOR')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'file', maxCount: 1 },
        { name: 'poster', maxCount: 1 },
        { name: 'frames', maxCount: 6 },
      ],
      { limits: { fileSize: VIDEO_SCRIPT.maxVideoBytes } },
    ),
  )
  addVideo(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
    @UploadedFiles() files: { file?: UploadedMulterFile[]; poster?: UploadedMulterFile[]; frames?: UploadedMulterFile[] } | undefined,
    @Body() body: { durationSec?: string; filename?: string; contentType?: string; uploadKey?: string; uploadId?: string; parts?: string; sourceId?: string },
  ): Promise<SlideImportView> {
    const video = files?.file?.[0];
    const poster = files?.poster?.[0];
    if (!poster) throw new BadRequestException('Manca la copertina del video (campo "poster")');
    // Video grande già caricato a pezzi: qui arrivano solo copertina, fotogrammi e l'elenco dei pezzi.
    let upload: { key: string; uploadId: string; parts: Array<{ partNumber: number; etag: string }> } | undefined;
    // Nuovo spezzone di un video già caricato: nessun file, solo copertina e fotogrammi del tratto.
    const sourceId = body.sourceId?.trim() || undefined;
    if (!video && !sourceId) {
      if (!body.uploadKey || !body.uploadId || !body.parts || !body.contentType || !body.filename) {
        throw new BadRequestException('Nessun video ricevuto (campo "file" o caricamento a pezzi)');
      }
      let parts: unknown;
      try {
        parts = JSON.parse(body.parts);
      } catch {
        throw new BadRequestException('Elenco dei pezzi non valido');
      }
      if (!Array.isArray(parts) || parts.some((p) => !Number.isInteger(p?.partNumber) || typeof p?.etag !== 'string')) {
        throw new BadRequestException('Elenco dei pezzi non valido');
      }
      upload = { key: body.uploadKey, uploadId: body.uploadId, parts: parts as Array<{ partNumber: number; etag: string }> };
    }
    const durationSec = body.durationSec;
    return this.slides.addVideo({
      tenantId: ctx.tenant.tenantId,
      courseId,
      importId,
      ...(sourceId
        ? { sourceId }
        : {
            video: video
              ? { filename: video.originalname, contentType: video.mimetype, content: video.buffer }
              : { filename: body.filename!, contentType: body.contentType!, upload },
          }),
      poster: { contentType: poster.mimetype, content: poster.buffer },
      frames: (files?.frames ?? []).map((f) => ({ contentType: f.mimetype, content: f.buffer })),
      durationSec: Number(durationSec),
    });
  }

  /** Apre il caricamento a pezzi di un video grande (nessuna richiesta supera pochi secondi). */
  @Post('imports/:importId/videos/uploads')
  @Roles('EDITOR')
  startVideoUpload(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
    @Body() body: { contentType?: string; sizeBytes?: number },
  ) {
    return this.slides.startVideoUpload(ctx.tenant.tenantId, courseId, importId, {
      contentType: String(body?.contentType ?? ''),
      sizeBytes: Number(body?.sizeBytes),
    });
  }

  /** Un pezzo del video (corpo binario, application/octet-stream). */
  @Put('imports/:importId/videos/uploads/part')
  @Roles('EDITOR')
  async uploadVideoPart(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
    @Query('key') key: string,
    @Query('uploadId') uploadId: string,
    @Query('partNumber') partNumber: string,
    @Req() req: NodeJS.ReadableStream,
  ) {
    const limit = SlidesService.VIDEO_PART_BYTES;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req as AsyncIterable<Buffer>) {
      size += c.length;
      if (size > limit) throw new BadRequestException('Pezzo troppo grande');
      chunks.push(c);
    }
    return this.slides.uploadVideoPart(ctx.tenant.tenantId, courseId, importId, {
      key: String(key ?? ''),
      uploadId: String(uploadId ?? ''),
      partNumber: Number(partNumber),
      body: Buffer.concat(chunks),
    });
  }

  /** Annulla un caricamento a pezzi lasciato a metà. */
  @Post('imports/:importId/videos/uploads/abort')
  @Roles('EDITOR')
  async abortVideoUpload(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
    @Body() body: { key?: string; uploadId?: string },
  ) {
    await this.slides.abortVideoUpload(ctx.tenant.tenantId, courseId, importId, { key: String(body?.key ?? ''), uploadId: String(body?.uploadId ?? '') });
    return { aborted: true };
  }

  /** Ordine, tratto e fonte del copione dei video (prima di generare i copioni). */
  @Put('imports/:importId/videos')
  @Roles('EDITOR')
  updateVideos(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
    @Body(new ZodValidationPipe(UpdateVideoImportSchema)) body: UpdateVideoImportType,
  ): Promise<SlideImportView> {
    return this.slides.updateVideos(ctx.tenant.tenantId, courseId, importId, body);
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
    // Import da video: ritmo di parlato aggiornato (misurato sulle clip) per la taratura in pagina.
    const base = doc
      ? doc.slides.some((x) => x.targetSec)
        ? { ...doc, wordsPerSec: await this.scripts.wordsPerSec(ctx.tenant.tenantId, courseId, importId, doc) }
        : doc
      : { status: 'none' as const };
    return generation ? { ...base, generation } : base;
  }

  /** Da video: come combaciano video e voce per ogni elemento (dopo le clip). */
  @Get('imports/:importId/timing')
  timing(@CurrentContext() ctx: AuthContext, @Param('courseId') courseId: string, @Param('importId') importId: string) {
    return this.lessons.videoTimings(ctx.tenant.tenantId, courseId, importId);
  }

  /** Adatta alla durata del video il copione di un elemento (l'AI lo accorcia o lo allunga). */
  @Post('imports/:importId/scripts/:index/fit')
  @Roles('EDITOR')
  fitScript(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
    @Param('index') index: string,
  ): Promise<SlideScriptsDoc> {
    const n = Number(index);
    if (!Number.isInteger(n) || n < 1) throw new BadRequestException('Video non valido');
    return this.scripts.fitToDuration(ctx.tenant.tenantId, courseId, importId, n);
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
  async changeAvatar(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
    @Body(new ZodValidationPipe(StartSlideClipsSchema)) body: StartSlideClipsType,
  ): Promise<SlideClipsView> {
    await this.avatarAccess.assertAvatarUsable({ tenantId: ctx.tenant.tenantId, userId: ctx.userId, role: ctx.role }, body.avatarId);
    body.avatarType = await this.avatarAccess.billingType(body.avatarId);
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
  async startClips(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
    @Body(new ZodValidationPipe(StartSlideClipsSchema)) body: StartSlideClipsType,
  ): Promise<SlideClipsView> {
    await this.avatarAccess.assertAvatarUsable({ tenantId: ctx.tenant.tenantId, userId: ctx.userId, role: ctx.role }, body.avatarId);
    body.avatarType = await this.avatarAccess.billingType(body.avatarId);
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

  /** Clip da rifare e rimontaggio in attesa, con il costo complessivo. */
  @Get('imports/:importId/changes')
  changes(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
  ) {
    return this.lessons.changes(ctx.tenant.tenantId, courseId, importId);
  }

  /** Applica in blocco le modifiche: rigenera le clip cambiate e rimonta il video. */
  @Post('imports/:importId/changes/apply')
  @Roles('EDITOR')
  applyChanges(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('importId') importId: string,
  ) {
    return this.lessons.applyChanges(ctx.tenant.tenantId, courseId, importId);
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
