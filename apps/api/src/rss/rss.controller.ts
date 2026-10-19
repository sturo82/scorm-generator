import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { LessonFormat } from '@scorm/contracts';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RssImportService } from './rss-import.service.js';
import { TenantFeedService } from './tenant-feed.service.js';
import { KnowledgeCourseService } from './knowledge-course.service.js';

/** Payload per creare un corso da un ARGOMENTO cercato sui feed. */
const CreateCourseFromRss = z.object({
  /** Argomento del corso (query semantica sui feed). */
  topic: z.string().min(2).max(300),
  /** Titolo del corso; se assente, derivato dall'argomento. */
  title: z.string().max(200).optional(),
  language: z.string().min(2).max(8).default('it'),
  /** Sorgente: 'everywhere' (Google News + feed curati + Wikipedia) o 'mine'. */
  source: z.enum(['everywhere', 'mine']).default('everywhere'),
  /** Categoria dei feed predefiniti (restringe la ricerca). */
  category: z
    .enum(['italia', 'mondo', 'economia', 'tech', 'sicurezza', 'scienza', 'salute', 'ambiente', 'cultura', 'sport', 'politica'])
    .optional(),
  /** Pubblico destinatario (opzionale): vincola la bozza di brief. */
  audience: z.string().max(1000).optional(),
  /** Tono di voce (opzionale): vincola la bozza di brief. */
  tone: z.string().max(1000).optional(),
  /** Taglio/scope (opzionale): vincola la bozza di brief e la generazione. */
  scope: z.string().max(2000).optional(),
  /**
   * Anteprima CONGELATA approvata dall'autore (pre-sommario mostrato in UI). Se
   * presente, è la spina dorsale del corso: titolo, descrizione, concetti e
   * lezioni vengono da qui invece di essere rigenerati, così il corso non si
   * discosta da ciò che l'utente ha visto. Resta modificabile nel wizard.
   */
  preview: z
    .object({
      // Limiti generosi: il pre-sommario è prodotto dall'LLM e questi campi
      // (tono/scope descrittivi) possono essere discorsivi. Il DTO deve
      // accettare esattamente ciò che l'anteprima ha restituito.
      proposedTitle: z.string().max(300).optional(),
      description: z.string().max(4000).optional(),
      keyConcepts: z.array(z.string().min(1).max(500)).max(20).optional(),
      suggestedLessons: z.array(z.string().min(1).max(300)).max(20).optional(),
      proposedAudience: z.string().max(1000).optional(),
      proposedTone: z.string().max(1000).optional(),
      proposedScope: z.string().max(2000).optional(),
    })
    .optional(),
  /** Numero di articoli pertinenti da includere (dopo filtro e dedup). */
  maxArticles: z.number().int().min(1).max(25).default(12),
  /** Formato per-lezione di DEFAULT (onboarding): orienta l'outline. */
  lessonFormatDefault: LessonFormat.optional(),
  /** Eccezioni di formato per-lezione per titolo (onboarding). */
  lessonFormatHints: z.record(z.string(), LessonFormat).optional(),
});
type CreateCourseFromRssType = z.infer<typeof CreateCourseFromRss>;

/** Payload per l'ANTEPRIMA (pre-sommario) del corso da un argomento. */
const PreviewCourseFromRss = z.object({
  topic: z.string().min(2).max(300),
  language: z.string().min(2).max(8).default('it'),
  source: z.enum(['everywhere', 'mine']).default('everywhere'),
  category: z
    .enum(['italia', 'mondo', 'economia', 'tech', 'sicurezza', 'scienza', 'salute', 'ambiente', 'cultura', 'sport', 'politica'])
    .optional(),
  /** Pubblico destinatario (opzionale): se assente lo propone l'anteprima. */
  audience: z.string().max(1000).optional(),
  /** Tono di voce (opzionale): se assente lo propone l'anteprima. */
  tone: z.string().max(1000).optional(),
  /** Taglio/scope del corso (opzionale): se assente lo propone l'anteprima. */
  scope: z.string().max(2000).optional(),
});
type PreviewCourseFromRssType = z.infer<typeof PreviewCourseFromRss>;

/** Anteprima/pre-sommario (riusato da argomento e da materiale). */
const FrozenPreviewSchema = z.object({
  proposedTitle: z.string().max(300).optional(),
  description: z.string().max(4000).optional(),
  keyConcepts: z.array(z.string().min(1).max(500)).max(20).optional(),
  suggestedLessons: z.array(z.string().min(1).max(300)).max(20).optional(),
  proposedAudience: z.string().max(1000).optional(),
  proposedTone: z.string().max(1000).optional(),
  proposedScope: z.string().max(2000).optional(),
});

/** Payload per l'ANTEPRIMA di un corso "dal mio materiale" (knowledge scelta). */
const PreviewCourseFromKnowledge = z.object({
  /** Documenti della knowledge GLOBAL selezionati come fonti. */
  documentIds: z.array(z.string().min(1)).min(1).max(100),
  language: z.string().min(2).max(8).default('it'),
  topic: z.string().max(300).optional(),
  audience: z.string().max(1000).optional(),
  tone: z.string().max(1000).optional(),
  scope: z.string().max(2000).optional(),
});
type PreviewCourseFromKnowledgeType = z.infer<typeof PreviewCourseFromKnowledge>;

/** Payload per CREARE un corso "dal mio materiale". */
const CreateCourseFromKnowledge = PreviewCourseFromKnowledge.extend({
  title: z.string().max(200).optional(),
  preview: FrozenPreviewSchema.optional(),
  lessonFormatDefault: LessonFormat.optional(),
  lessonFormatHints: z.record(z.string(), LessonFormat).optional(),
});
type CreateCourseFromKnowledgeType = z.infer<typeof CreateCourseFromKnowledge>;

/** Payload per salvare un feed personalizzato del tenant. */
const AddFeed = z.object({
  url: z.string().url(),
  name: z.string().max(200).optional(),
});
type AddFeedType = z.infer<typeof AddFeed>;

/**
 * API per creare corsi da un ARGOMENTO cercato sui feed RSS, e per gestire i
 * feed personalizzati del tenant. Scrittura: ruolo EDITOR.
 */
@Controller()
@Roles('EDITOR')
export class RssController {
  constructor(
    private readonly rss: RssImportService,
    private readonly tenantFeeds: TenantFeedService,
    private readonly knowledgeCourse: KnowledgeCourseService,
  ) {}

  @Post('courses/from-rss')
  create(
    @CurrentContext() ctx: AuthContext,
    @Body(new ZodValidationPipe(CreateCourseFromRss)) dto: CreateCourseFromRssType,
  ) {
    return this.rss.createCourseFromRss({
      tenantId: ctx.tenant.tenantId,
      topic: dto.topic,
      title: dto.title,
      language: dto.language,
      source: dto.source,
      category: dto.category,
      audience: dto.audience,
      tone: dto.tone,
      scope: dto.scope,
      preview: dto.preview,
      maxArticles: dto.maxArticles,
      lessonFormatDefault: dto.lessonFormatDefault,
      lessonFormatHints: dto.lessonFormatHints,
      correlationId: ctx.correlationId,
    });
  }

  /** Anteprima: pre-sommario dei concetti, senza creare il corso. */
  @Post('courses/from-rss/preview')
  preview(
    @CurrentContext() ctx: AuthContext,
    @Body(new ZodValidationPipe(PreviewCourseFromRss)) dto: PreviewCourseFromRssType,
  ) {
    return this.rss.previewCourseFromRss({
      tenantId: ctx.tenant.tenantId,
      topic: dto.topic,
      language: dto.language,
      source: dto.source,
      category: dto.category,
      audience: dto.audience,
      tone: dto.tone,
      scope: dto.scope,
    });
  }

  // --- Corso DAL MIO MATERIALE (knowledge selezionata) ----------------------

  /** Anteprima: pre-sommario dai documenti knowledge scelti, senza creare il corso. */
  @Post('courses/from-knowledge/preview')
  previewFromKnowledge(
    @CurrentContext() ctx: AuthContext,
    @Body(new ZodValidationPipe(PreviewCourseFromKnowledge)) dto: PreviewCourseFromKnowledgeType,
  ) {
    return this.knowledgeCourse.previewFromKnowledge({
      tenantId: ctx.tenant.tenantId,
      documentIds: dto.documentIds,
      language: dto.language,
      topic: dto.topic,
      audience: dto.audience,
      tone: dto.tone,
      scope: dto.scope,
    });
  }

  @Post('courses/from-knowledge')
  createFromKnowledge(
    @CurrentContext() ctx: AuthContext,
    @Body(new ZodValidationPipe(CreateCourseFromKnowledge)) dto: CreateCourseFromKnowledgeType,
  ) {
    return this.knowledgeCourse.createFromKnowledge({
      tenantId: ctx.tenant.tenantId,
      documentIds: dto.documentIds,
      language: dto.language,
      topic: dto.topic,
      title: dto.title,
      audience: dto.audience,
      tone: dto.tone,
      scope: dto.scope,
      preview: dto.preview,
      lessonFormatDefault: dto.lessonFormatDefault,
      lessonFormatHints: dto.lessonFormatHints,
    });
  }

  // --- Feed personalizzati del tenant ---------------------------------------

  @Get('tenant/feeds')
  listFeeds(@CurrentContext() ctx: AuthContext) {
    return this.tenantFeeds.list(ctx.tenant.tenantId);
  }

  @Post('tenant/feeds')
  addFeed(@CurrentContext() ctx: AuthContext, @Body(new ZodValidationPipe(AddFeed)) dto: AddFeedType) {
    return this.tenantFeeds.add(ctx.tenant.tenantId, dto.url, dto.name);
  }

  @Delete('tenant/feeds/:id')
  async removeFeed(@CurrentContext() ctx: AuthContext, @Param('id') id: string) {
    await this.tenantFeeds.remove(ctx.tenant.tenantId, id);
    return { deleted: true };
  }
}
