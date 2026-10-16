import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FeedProvider } from '@scorm/domain';
import { RssFeedProvider } from '@scorm/adapters/rss';
import type { AppConfig } from '../config/configuration.js';
import { FEED_PROVIDER } from '../providers/provider.constants.js';
import { CoursesModule } from '../courses/courses.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { RssController } from './rss.controller.js';
import { RssImportService } from './rss-import.service.js';
import { TenantFeedService } from './tenant-feed.service.js';
import { RssBriefService } from './rss-brief.service.js';

/**
 * Provider del recupero feed RSS. Non richiede API key: è sempre disponibile
 * (richieste HTTP con anti-SSRF). I default (timeout, dimensione max) sono
 * nell'adapter.
 */
const feedProvider = {
  provide: FEED_PROVIDER,
  inject: [ConfigService],
  useFactory: (_config: ConfigService<AppConfig, true>): FeedProvider => new RssFeedProvider(),
};

/**
 * Modulo "crea corso da argomento (RSS)". Riusa CoursesService (corso + brief),
 * KnowledgeService (ingestion articoli) e i provider globali LLM/Embeddings (per
 * selezione semantica e autocompletamento brief). Espone anche il CRUD dei feed
 * personalizzati del tenant.
 */
@Module({
  imports: [CoursesModule, KnowledgeModule],
  controllers: [RssController],
  providers: [RssImportService, TenantFeedService, RssBriefService, feedProvider],
  exports: [RssImportService, TenantFeedService],
})
export class RssModule {}
