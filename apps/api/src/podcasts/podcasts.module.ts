import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FeedProvider, SpeechProvider } from '@scorm/domain';
import { PollySpeechProvider } from '@scorm/adapters/polly';
import { HeygenSpeechProvider } from '@scorm/adapters/heygen';
import { RssFeedProvider } from '@scorm/adapters/rss';
import type { AppConfig } from '../config/configuration.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { SPEECH_PROVIDER } from '../providers/provider.constants.js';
import { PODCAST_FEED, PODCAST_HEYGEN_SPEECH, PODCAST_SPEECH } from './podcast.constants.js';
import { PodcastGenerationService } from './podcast-generation.service.js';
import { PodcastPublishService } from './podcast-publish.service.js';
import { PodcastVoicesService } from './podcast-voices.service.js';
import { PodcastsController } from './podcasts.controller.js';
import { PodcastsService } from './podcasts.service.js';

/**
 * Voce dei podcast: con Polly si usa un client nella regione dedicata (le voci generative stanno a
 * Francoforte), che può differire da quella delle immagini e delle altre narrazioni. Senza Polly
 * (sviluppo e test) si usa il provider di voce comune, cioè il mock.
 */
const podcastSpeech = {
  provide: PODCAST_SPEECH,
  inject: [ConfigService, SPEECH_PROVIDER],
  useFactory: (config: ConfigService<AppConfig, true>, shared: SpeechProvider): SpeechProvider => {
    if (config.get('providers', { infer: true }).speech !== 'polly') return shared;
    const cfg = config.get('podcast', { infer: true });
    const media = config.get('media', { infer: true });
    const aws = config.get('bedrock', { infer: true });
    return new PollySpeechProvider({
      region: cfg.speechRegion,
      // Il motore generativo non è nel tipo dell'SDK installato, ma Polly lo accetta.
      engine: cfg.speechEngine as never,
      defaultVoice: media.speechDefaultVoice,
      accessKeyId: aws.accessKeyId,
      secretAccessKey: aws.secretAccessKey,
      sessionToken: aws.sessionToken,
    });
  },
};

/** Voci HeyGen (anche quelle proprie, clonate con gli avatar): solo se c'è la chiave API. */
const podcastHeygenSpeech = {
  provide: PODCAST_HEYGEN_SPEECH,
  inject: [ConfigService],
  useFactory: (config: ConfigService<AppConfig, true>): SpeechProvider | null => {
    const h = config.get('heygen', { infer: true });
    if (!h.apiKey) return null;
    return new HeygenSpeechProvider({ apiKey: h.apiKey, baseUrl: h.baseUrl, model: process.env['HEYGEN_VOICE_MODEL'] || undefined });
  },
};

const podcastFeed = {
  provide: PODCAST_FEED,
  useFactory: (): FeedProvider => new RssFeedProvider(),
};

/** Podcast: serie di puntate audio a due voci, con feed RSS. Vedi .kiro/specs/podcast. */
@Module({
  imports: [KnowledgeModule],
  controllers: [PodcastsController],
  providers: [
    PodcastsService,
    PodcastGenerationService,
    PodcastVoicesService,
    PodcastPublishService,
    podcastSpeech,
    podcastHeygenSpeech,
    podcastFeed,
  ],
  exports: [PodcastsService],
})
export class PodcastsModule {}
