import {
  BadRequestException,
  Body,
  Controller,
  Get,
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

/** Opzioni per la generazione della narrazione audio (TTS). */
class GenerateNarrationDto {
  /**
   * Override puntuale del motore TTS: 'standard' (economico) o 'neural' (qualità
   * superiore, più costoso). Se assente, si usa la preferenza del corso o il
   * default dell'ambiente.
   */
  @IsOptional()
  @IsIn(['standard', 'neural'])
  engine?: 'standard' | 'neural';
}

/** Opzioni per la generazione del video avatar di un concetto. */
class GenerateConceptVideoDto {
  /** Avatar HeyGen scelto dall'autore (altrimenti il default configurato). */
  @IsOptional()
  @IsString()
  avatarId?: string;

  /** Voce TTS scelta dall'autore (altrimenti la voce di default dell'avatar). */
  @IsOptional()
  @IsString()
  voiceId?: string;

  // NB: l'engine NON è scelto dal client. Il server seleziona l'engine di
  // default in base al tipo di avatar (vedi MediaService.generateConceptVideo).

  /** Copione esplicito; se assente viene sintetizzato dal testo del concetto. */
  @IsOptional()
  @IsString()
  script?: string;
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

  /** Genera TUTTI i test mancanti (di cui esiste il contenuto) in un unico job. */
  @Post('assessment/all')
  @HttpCode(202)
  allAssessments(@CurrentContext() ctx: AuthContext, @Param('courseId') courseId: string) {
    return this.generation.enqueueAllAssessments(ctx, courseId);
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
    @Body() dto: GenerateNarrationDto = {},
  ) {
    return this.media.generateLessonNarration(ctx.tenant.tenantId, courseId, lessonId, dto.engine);
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

  /**
   * (Ri)avvia la trascrizione automatica (ASR) del video già presente nel block,
   * senza rigenerarlo. Asincrono: 202 + stato 'processing'; il risultato arriva
   * nel payload del block (transcriptStatus) via polling.
   */
  @Post('lessons/:lessonId/blocks/:blockId/transcribe')
  @HttpCode(202)
  retranscribeVideo(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Param('blockId') blockId: string,
  ) {
    return this.media.retranscribeLessonVideo(ctx.tenant.tenantId, courseId, lessonId, blockId);
  }

  /**
   * Genera un VIDEO con avatar parlante (HeyGen) per un singolo concetto della
   * lezione, in alternativa al concetto testuale (approccio manuale: l'autore
   * sceglie quale concetto trasformare in video). Se il block indicato è un
   * concetto rich_text, viene convertito in un block video che ne conserva il
   * testo. Asincrono: ritorna 202 + stato 'processing'; il rendering prosegue
   * in background e il block si aggiorna a 'ready' col video scaricato.
   * Soggetto alla quota mensile del piano (Free: 3 video/mese).
   */
  @Post('lessons/:lessonId/blocks/:blockId/video/heygen')
  @HttpCode(202)
  generateConceptVideo(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Param('blockId') blockId: string,
    @Body() dto: GenerateConceptVideoDto,
  ) {
    return this.media.generateConceptVideo(ctx.tenant.tenantId, courseId, lessonId, blockId, {
      avatarId: dto.avatarId,
      voiceId: dto.voiceId,
      script: dto.script,
    });
  }

  /**
   * Genera i mini-cartoon (code-to-video) delle scene di una lezione. Le scene
   * sono raccolte da qualunque block che le ospiti: branching_scenario (una per
   * node) o video_checkpoint (una per block). Senza :nodeId genera TUTTE le
   * scene con video segnaposto; con :nodeId genera solo quella scena (per gli
   * scenari :nodeId è l'id del node, per i video_checkpoint è l'id del block).
   * Asincrono: le scene vanno a 'processing' e poi 'ready' (polling in
   * background). Soggetto a quota mensile.
   */
  @Post('lessons/:lessonId/blocks/:blockId/cartoon')
  @HttpCode(202)
  generateScenesCartoon(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Param('blockId') blockId: string,
  ) {
    return this.media.generateScenesCartoon(ctx.tenant.tenantId, courseId, lessonId, blockId);
  }

  @Post('lessons/:lessonId/blocks/:blockId/scenes/:nodeId/cartoon')
  @HttpCode(202)
  generateSceneCartoon(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Param('blockId') blockId: string,
    @Param('nodeId') nodeId: string,
  ) {
    return this.media.generateScenesCartoon(ctx.tenant.tenantId, courseId, lessonId, blockId, nodeId);
  }

  /**
   * Elenca gli avatar HeyGen UNA PAGINA alla volta (no quota). `source`
   * ('mine'|'stock'), `token` (cursore pagina), `q` (ricerca per nome).
   */
  @Get('video/avatars')
  listVideoAvatars(
    @Query('source') source?: string,
    @Query('token') token?: string,
    @Query('q') q?: string,
  ) {
    return this.media.listVideoAvatars({
      source: source === 'mine' ? 'mine' : 'stock',
      token,
      query: q,
    });
  }

  /**
   * Elenca le voci HeyGen UNA PAGINA alla volta (no quota), filtrate per lingua
   * del corso (default) o `language` (es. ?language=all per tutte). `token`
   * pagina, `q` cerca per nome.
   */
  @Get('video/voices')
  listVideoVoices(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Query('language') language?: string,
    @Query('token') token?: string,
    @Query('q') q?: string,
  ) {
    return this.media.listVideoVoices(ctx.tenant.tenantId, courseId, {
      languageOverride: language,
      token,
      query: q,
    });
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
