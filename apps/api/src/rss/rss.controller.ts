import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RssImportService } from './rss-import.service.js';
import { TenantFeedService } from './tenant-feed.service.js';

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
    .enum(['italia', 'mondo', 'economia', 'tech', 'scienza', 'salute', 'ambiente', 'cultura', 'sport', 'politica'])
    .optional(),
  /** Numero di articoli pertinenti da includere (dopo filtro e dedup). */
  maxArticles: z.number().int().min(1).max(25).default(12),
});
type CreateCourseFromRssType = z.infer<typeof CreateCourseFromRss>;

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
      maxArticles: dto.maxArticles,
      correlationId: ctx.correlationId,
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
