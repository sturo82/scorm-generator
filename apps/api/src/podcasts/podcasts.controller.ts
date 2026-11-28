import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import {
  CreatePodcast,
  CreatePodcastEpisode,
  MoveCourse,
  PODCAST_COVER,
  PODCAST_LIMITS,
  PodcastVoiceProvider,
  SetPodcastFeed,
  SuggestPodcastIdeas,
  UpdatePodcast,
  UpdatePodcastEpisodes,
  UpdatePodcastScript,
  type CreatePodcast as CreatePodcastType,
  type CreatePodcastEpisode as CreatePodcastEpisodeType,
  type SuggestPodcastIdeas as SuggestPodcastIdeasType,
  type SetPodcastFeed as SetPodcastFeedType,
  type UpdatePodcast as UpdatePodcastType,
  type UpdatePodcastEpisodes as UpdatePodcastEpisodesType,
  type PodcastScript,
} from '@scorm/contracts';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PodcastGenerationService } from './podcast-generation.service.js';
import { PodcastPublishService } from './podcast-publish.service.js';
import { PodcastVoicesService } from './podcast-voices.service.js';
import { PodcastsService } from './podcasts.service.js';

const EpisodeIds = z.object({ episodeIds: z.array(z.string().min(1)).max(PODCAST_LIMITS.maxEpisodes).optional() });
const VoiceDesign = z.object({ name: z.string().trim().min(1).max(60), description: z.string().trim().min(10).max(500), language: z.string().min(2).max(10) });
const VoicePreview = z.object({ voiceId: z.string().min(1).max(64), provider: PodcastVoiceProvider.default('polly'), language: z.string().min(2).max(10) });

/**
 * API dei podcast: serie, puntate, voci, generazione, pubblicazione e feed. Lettura per tutti gli
 * utenti dell'azienda; scrittura e generazione per EDITOR.
 */
@Controller('podcasts')
export class PodcastsController {
  constructor(
    private readonly podcasts: PodcastsService,
    private readonly generation: PodcastGenerationService,
    private readonly voices: PodcastVoicesService,
    private readonly publish: PodcastPublishService,
  ) {}

  // --- Elenco, preventivo, voci e fonti (prima di ":id") --------------------------

  @Get()
  list(@CurrentContext() ctx: AuthContext) {
    return this.podcasts.list(ctx.tenant.tenantId);
  }

  /** Preventivo di una nuova puntata: copione e audio. */
  @Get('estimate')
  estimateNew(@CurrentContext() ctx: AuthContext, @Query('minutes') minutes?: string, @Query('podcastId') podcastId?: string) {
    const m = Math.min(PODCAST_LIMITS.maxMinutes, Math.max(PODCAST_LIMITS.minMinutes, Math.round(Number(minutes) || 8)));
    return this.podcasts.estimateNew(ctx.tenant.tenantId, m, podcastId || undefined);
  }

  /** Voci disponibili per la lingua della serie. */
  @Get('voices')
  listVoices(@CurrentContext() ctx: AuthContext, @Query('language') language?: string) {
    return this.voices.list(language || 'it', ctx.tenant.tenantId);
  }

  /** Se si possono creare voci nuove (HeyGen, solo azienda della piattaforma). */
  @Get('voices/capabilities')
  voiceCapabilities(@CurrentContext() ctx: AuthContext) {
    return { design: this.voices.canDesign(ctx.tenant.tenantId) };
  }

  /** Crea una voce nuova da una descrizione. */
  @Post('voices/design')
  @Roles('EDITOR')
  designVoice(@CurrentContext() ctx: AuthContext, @Body(new ZodValidationPipe(VoiceDesign)) body: z.infer<typeof VoiceDesign>) {
    return this.voices.designVoice(ctx.tenant.tenantId, body);
  }

  /** Stato di una voce in creazione. */
  @Get('voices/design/:voiceId')
  designStatus(@CurrentContext() ctx: AuthContext, @Param('voiceId') voiceId: string) {
    return this.voices.designStatus(ctx.tenant.tenantId, voiceId);
  }

  /** Breve audio di prova di una voce. */
  @Post('voices/preview')
  @Roles('EDITOR')
  previewVoice(@CurrentContext() ctx: AuthContext, @Body(new ZodValidationPipe(VoicePreview)) body: z.infer<typeof VoicePreview>) {
    return this.voices.preview(ctx.tenant.tenantId, { provider: body.provider, id: body.voiceId }, body.language);
  }

  /** Articoli recenti di un feed RSS, per sceglierli come fonte. */
  @Get('feed-items')
  feedItems(@Query('url') url: string) {
    return this.podcasts.feedItems(url);
  }

  @Post()
  @Roles('EDITOR')
  create(@CurrentContext() ctx: AuthContext, @Body(new ZodValidationPipe(CreatePodcast)) dto: CreatePodcastType) {
    return this.podcasts.create(ctx.tenant.tenantId, ctx.userId, dto);
  }

  // --- Una serie -------------------------------------------------------------------

  @Get(':id')
  get(@CurrentContext() ctx: AuthContext, @Param('id') id: string) {
    return this.podcasts.get(ctx.tenant.tenantId, id);
  }

  @Put(':id')
  @Roles('EDITOR')
  update(@CurrentContext() ctx: AuthContext, @Param('id') id: string, @Body(new ZodValidationPipe(UpdatePodcast)) dto: UpdatePodcastType) {
    return this.podcasts.update(ctx.tenant.tenantId, id, dto);
  }

  /** Sposta la serie in una cartella (folderId null = radice). */
  @Put(':id/folder')
  @Roles('EDITOR')
  async moveToFolder(@CurrentContext() ctx: AuthContext, @Param('id') id: string, @Body(new ZodValidationPipe(MoveCourse)) dto: z.infer<typeof MoveCourse>) {
    await this.podcasts.moveToFolder(ctx.tenant.tenantId, id, dto.folderId);
    return { moved: true };
  }

  @Delete(':id')
  @Roles('EDITOR')
  async remove(@CurrentContext() ctx: AuthContext, @Param('id') id: string) {
    await this.podcasts.remove(ctx.tenant.tenantId, id);
    return { deleted: true };
  }

  /** Preventivo del lavoro ancora da fare su una serie. */
  @Get(':id/estimate')
  estimate(@CurrentContext() ctx: AuthContext, @Param('id') id: string) {
    return this.podcasts.estimateExisting(ctx.tenant.tenantId, id);
  }

  /** Copertina (JPEG o PNG, quadrata da 1400 a 3000 px per il feed). */
  @Post(':id/cover')
  @Roles('EDITOR')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PODCAST_COVER.maxBytes } }))
  async cover(@CurrentContext() ctx: AuthContext, @Param('id') id: string, @UploadedFile() file: { mimetype: string; buffer: Buffer } | undefined) {
    if (!file) throw new BadRequestException('Nessun file ricevuto (campo "file")');
    await this.publish.setCover(ctx.tenant.tenantId, id, { mimeType: file.mimetype, content: file.buffer });
    return this.podcasts.get(ctx.tenant.tenantId, id);
  }

  // --- Piano, copioni, audio -------------------------------------------------------

  /** Aggiunge una puntata in fondo alla serie. */
  @Post(':id/episodes')
  @Roles('EDITOR')
  addEpisode(@CurrentContext() ctx: AuthContext, @Param('id') id: string, @Body(new ZodValidationPipe(CreatePodcastEpisode)) dto: CreatePodcastEpisodeType) {
    return this.podcasts.addEpisode(ctx.tenant.tenantId, id, dto);
  }

  /** Idee per le prossime puntate: non crea nulla, l'utente sceglie quali usare. */
  @Post(':id/ideas')
  @Roles('EDITOR')
  ideas(@CurrentContext() ctx: AuthContext, @Param('id') id: string, @Body(new ZodValidationPipe(SuggestPodcastIdeas)) dto: SuggestPodcastIdeasType) {
    return this.podcasts.ideas(ctx.tenant.tenantId, id, dto);
  }

  @Put(':id/episodes')
  @Roles('EDITOR')
  episodes(@CurrentContext() ctx: AuthContext, @Param('id') id: string, @Body(new ZodValidationPipe(UpdatePodcastEpisodes)) dto: UpdatePodcastEpisodesType) {
    return this.podcasts.updateEpisodes(ctx.tenant.tenantId, id, dto);
  }

  /** Scrive i copioni (di tutte le puntate senza copione, o delle indicate). */
  @Post(':id/scripts')
  @Roles('EDITOR')
  async scripts(@CurrentContext() ctx: AuthContext, @Param('id') id: string, @Body(new ZodValidationPipe(EpisodeIds)) body: z.infer<typeof EpisodeIds>) {
    await this.generation.startScripts(ctx.tenant.tenantId, id, body.episodeIds);
    return this.podcasts.get(ctx.tenant.tenantId, id);
  }

  @Put(':id/episodes/:eid/script')
  @Roles('EDITOR')
  script(
    @CurrentContext() ctx: AuthContext,
    @Param('id') id: string,
    @Param('eid') eid: string,
    @Body(new ZodValidationPipe(UpdatePodcastScript)) dto: PodcastScript,
  ) {
    return this.podcasts.updateScript(ctx.tenant.tenantId, id, eid, dto);
  }

  /** Registra l'audio (di tutte le puntate con copione e senza audio aggiornato, o delle indicate). */
  @Post(':id/audio')
  @Roles('EDITOR')
  async audio(@CurrentContext() ctx: AuthContext, @Param('id') id: string, @Body(new ZodValidationPipe(EpisodeIds)) body: z.infer<typeof EpisodeIds>) {
    await this.generation.startAudio(ctx.tenant.tenantId, id, body.episodeIds);
    return this.podcasts.get(ctx.tenant.tenantId, id);
  }

  /** Ferma il lavoro in corso dopo la puntata attuale: si addebita solo il lavoro fatto. */
  @Post(':id/cancel')
  @Roles('EDITOR')
  async cancel(@CurrentContext() ctx: AuthContext, @Param('id') id: string) {
    await this.podcasts.get(ctx.tenant.tenantId, id);
    this.generation.cancel(id);
    return { cancelling: true };
  }

  // --- Ascolto e trascritto -------------------------------------------------------

  @Get(':id/episodes/:eid/audio')
  audioUrl(@CurrentContext() ctx: AuthContext, @Param('id') id: string, @Param('eid') eid: string) {
    return this.podcasts.audioUrl(ctx.tenant.tenantId, id, eid);
  }

  @Get(':id/episodes/:eid/transcript')
  transcript(@CurrentContext() ctx: AuthContext, @Param('id') id: string, @Param('eid') eid: string, @Query('format') format?: string) {
    const f = format === 'srt' || format === 'vtt' ? format : 'txt';
    return this.podcasts.transcript(ctx.tenant.tenantId, id, eid, f);
  }

  // --- Pubblicazione e feed -----------------------------------------------------------

  @Post(':id/episodes/:eid/publish')
  @Roles('EDITOR')
  async publishEpisode(@CurrentContext() ctx: AuthContext, @Param('id') id: string, @Param('eid') eid: string) {
    await this.publish.publish(ctx.tenant.tenantId, id, eid);
    return this.podcasts.get(ctx.tenant.tenantId, id);
  }

  @Delete(':id/episodes/:eid/publish')
  @Roles('EDITOR')
  async unpublishEpisode(@CurrentContext() ctx: AuthContext, @Param('id') id: string, @Param('eid') eid: string) {
    await this.publish.unpublish(ctx.tenant.tenantId, id, eid);
    return this.podcasts.get(ctx.tenant.tenantId, id);
  }

  @Put(':id/feed')
  @Roles('EDITOR')
  async setFeed(@CurrentContext() ctx: AuthContext, @Param('id') id: string, @Body(new ZodValidationPipe(SetPodcastFeed)) dto: SetPodcastFeedType) {
    await this.publish.setVisibility(ctx.tenant.tenantId, id, dto.visibility);
    return this.podcasts.get(ctx.tenant.tenantId, id);
  }

  @Post(':id/feed/rotate-token')
  @Roles('EDITOR')
  async rotate(@CurrentContext() ctx: AuthContext, @Param('id') id: string) {
    await this.publish.rotateToken(ctx.tenant.tenantId, id);
    return this.podcasts.get(ctx.tenant.tenantId, id);
  }
}
