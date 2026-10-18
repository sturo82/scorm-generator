import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  JobEnvelope,
  JobQueue,
  VideoGenerationProvider,
  TextToVideoProvider,
  LLMProvider,
  SpeechProvider,
} from '@scorm/domain';
import { HeyGenVideoProvider } from '@scorm/adapters/heygen';
import { NovaReelProvider, LumaRayProvider } from '@scorm/adapters/bedrock';
import { testing, RemotionCartoonProvider, type RenderFn } from '@scorm/adapters';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { CoursesModule } from '../courses/courses.module.js';
import type { AppConfig } from '../config/configuration.js';
import {
  JOB_QUEUE,
  VIDEO_GEN_PROVIDER,
  CARTOON_VIDEO_PROVIDER,
  LLM_PROVIDER,
  SPEECH_PROVIDER,
} from '../providers/provider.constants.js';
import { generateVideoSpec } from './video-spec.generator.js';
import {
  GenerationService,
  type GenJobType,
  type GenJobPayload,
} from './generation.service.js';
import { MediaService } from './media.service.js';
import { GenerationController } from './generation.controller.js';
import { AvatarsController } from './avatars.controller.js';
import { JobsController } from './jobs.controller.js';
import { ActiveJobsController } from './active-jobs.controller.js';

/**
 * Provider del generatore video avatar, scelto da configurazione (pattern
 * identico allo stock image provider):
 *  - PROVIDER_VIDEO=heygen + HEYGEN_API_KEY → adapter HeyGen reale
 *  - PROVIDER_VIDEO=mock                    → mock deterministico (no quota)
 *  - altrimenti                             → null: il service risponde 501
 */
const videoGenProvider = {
  provide: VIDEO_GEN_PROVIDER,
  inject: [ConfigService],
  useFactory: (config: ConfigService<AppConfig, true>): VideoGenerationProvider | null => {
    const cfg = config.get('heygen', { infer: true });
    if (cfg.provider === 'heygen' && cfg.apiKey) {
      return new HeyGenVideoProvider({
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        defaultAvatarId: cfg.defaultAvatarId,
        defaultVoiceId: cfg.defaultVoiceId,
        defaultResolution: cfg.resolution,
        defaultEngine: cfg.engine || undefined,
      });
    }
    if (cfg.provider === 'mock') {
      return new testing.MockVideoGenerationProvider();
    }
    return null;
  },
};

/**
 * Provider dei cartoon delle scene "pillole" (text-to-video), scelto da config:
 *  - PROVIDER_CARTOON_VIDEO=nova + NOVA_REEL_OUTPUT_S3_URI → Amazon Nova Reel
 *  - PROVIDER_CARTOON_VIDEO=mock                           → mock (no costi AWS)
 *  - altrimenti                                            → null: service 501
 */
const cartoonVideoProvider = {
  provide: CARTOON_VIDEO_PROVIDER,
  inject: [ConfigService, LLM_PROVIDER, SPEECH_PROVIDER],
  useFactory: (
    config: ConfigService<AppConfig, true>,
    llm: LLMProvider,
    speech: SpeechProvider,
  ): TextToVideoProvider | null => {
    const cfg = config.get('cartoonVideo', { infer: true });
    const aws = config.get('bedrock', { infer: true });
    const creds = {
      accessKeyId: aws.accessKeyId,
      secretAccessKey: aws.secretAccessKey,
      sessionToken: aws.sessionToken,
    };
    // Code-to-video deterministico (Remotion): LLM->VideoSpec, Polly->voce+marks,
    // render->MP4. Nessun modello neurale, costo ~solo TTS+CPU.
    if (cfg.provider === 'remotion') {
      // Import DINAMICO di @scorm/video (Remotion/Chromium, pesante): caricato
      // SOLO quando il provider è attivo, così l'immagine API senza remotion non
      // deve includerlo e non paga l'avvio.
      // renderMode sceglie DOVE gira Chromium:
      //  - 'lambda' (enterprise): render su AWS Lambda, isolato e scalabile;
      //  - 'inprocess' (MVP): render nel processo API (richiede Chromium locale).
      const render: RenderFn =
        cfg.renderMode === 'lambda'
          ? async (args) => {
              const { renderPillolaOnLambda } = await import('@scorm/video');
              return renderPillolaOnLambda(args, {
                region: cfg.lambdaRegion,
                functionName: cfg.lambdaFunctionName,
                serveUrl: cfg.lambdaServeUrl,
              });
            }
          : async (args) => {
              const { renderPillola } = await import('@scorm/video');
              return renderPillola(args);
            };
      return new RemotionCartoonProvider({
        speech,
        generateSpec: (input) => generateVideoSpec(llm, input),
        render,
      });
    }
    if (cfg.provider === 'luma' && cfg.outputS3Uri) {
      return new LumaRayProvider({
        modelId: cfg.modelId,
        region: cfg.region,
        outputS3Uri: cfg.outputS3Uri,
        ...creds,
      });
    }
    if (cfg.provider === 'nova' && cfg.outputS3Uri) {
      return new NovaReelProvider({
        modelId: cfg.modelId,
        region: cfg.region,
        outputS3Uri: cfg.outputS3Uri,
        ...creds,
      });
    }
    if (cfg.provider === 'mock') {
      return new testing.MockTextToVideoProvider();
    }
    return null;
  },
};

/**
 * Modulo di generazione AI. Importa KnowledgeModule per il RetrievalService
 * (RAG) e CoursesModule per ModulesService (materializzazione outline). I
 * provider (LLM, immagini, audio, storage, coda) sono risolti dal container
 * globale. Registra gli handler dei job di generazione sulla coda: così gli
 * endpoint accodano e il worker esegue il modello fuori dalla request HTTP.
 */
@Module({
  imports: [KnowledgeModule, CoursesModule],
  controllers: [GenerationController, AvatarsController, JobsController, ActiveJobsController],
  providers: [GenerationService, MediaService, videoGenProvider, cartoonVideoProvider],
  exports: [GenerationService, MediaService],
})
export class GenerationModule implements OnModuleInit {
  constructor(
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    private readonly generation: GenerationService,
  ) {}

  onModuleInit(): void {
    const types: GenJobType[] = [
      'course.generate_outline',
      'course.generate_content',
      'course.generate_all_content',
      'course.generate_assessment',
      'course.generate_all_assessments',
    ];
    for (const type of types) {
      this.jobs.register<GenJobPayload & { jobId: string }>(
        type,
        async (job: JobEnvelope<GenJobPayload & { jobId: string }>) => {
          await this.generation.handleJob({ ...job.payload, type }, job.context);
        },
      );
    }
    // Recupero job orfani lasciati da un riavvio: non blocca il bootstrap.
    void this.generation.recoverStaleJobs().catch(() => undefined);
  }
}
