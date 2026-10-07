import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Container, TOKENS } from '@scorm/domain';
import { testing } from '@scorm/adapters';
import { S3ObjectStorage } from '@scorm/adapters/aws';
import { PgVectorStore } from '@scorm/adapters/pgvector';
import { createDefaultExtractors } from '@scorm/adapters/extractors';
import { BedrockLLMProvider, BedrockEmbeddingsProvider, BedrockImageProvider } from '@scorm/adapters/bedrock';
import { PollySpeechProvider } from '@scorm/adapters/polly';
import { TranscribeProvider } from '@scorm/adapters/transcribe';
import { SqsJobQueue } from '@scorm/adapters/aws';
import type { AppConfig } from '../config/configuration.js';
import { providerBindings } from './provider.tokens.js';
import {
  DOCUMENT_EXTRACTORS,
  DOMAIN_CONTAINER,
  EMBEDDINGS_PROVIDER,
  IMAGE_PROVIDER,
  JOB_QUEUE,
  LLM_PROVIDER,
  OBJECT_STORAGE,
  SPEECH_PROVIDER,
  TRANSCRIPTION_PROVIDER,
  VECTOR_STORE,
} from './provider.constants.js';

/**
 * Composition root: costruisce il Container di dominio e registra gli adapter
 * concreti in base alla configurazione (Requisito 10.3 / 10.4), per-provider.
 * Gli adapter mock/in-memory restano la scelta di default per lo sviluppo; i
 * reali (S3, pgvector, Bedrock) si attivano via variabili d'ambiente.
 */
@Global()
@Module({
  providers: [
    {
      provide: DOMAIN_CONTAINER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>): Container => {
        const providers = config.get('providers', { infer: true });
        const container = new Container();

        // LLM: Bedrock reale se configurato, altrimenti mock deterministico.
        const bedrock = config.get('bedrock', { infer: true });
        if (providers.llm === 'bedrock') {
          container.registerValue(
            TOKENS.LLMProvider,
            new BedrockLLMProvider({
              modelId: bedrock.llmModelId,
              region: bedrock.region,
              accessKeyId: bedrock.accessKeyId,
              secretAccessKey: bedrock.secretAccessKey,
              sessionToken: bedrock.sessionToken,
            }),
          );
        } else {
          container.registerValue(TOKENS.LLMProvider, new testing.MockLLMProvider());
        }

        // Embeddings: Bedrock reale se configurato, altrimenti mock.
        const embDims = config.get('embeddings', { infer: true }).dimensions;
        if (providers.embeddings === 'bedrock') {
          container.registerValue(
            TOKENS.EmbeddingsProvider,
            new BedrockEmbeddingsProvider({
              modelId: bedrock.embeddingsModelId,
              dimensions: embDims,
              region: bedrock.region,
              accessKeyId: bedrock.accessKeyId,
              secretAccessKey: bedrock.secretAccessKey,
              sessionToken: bedrock.sessionToken,
            }),
          );
        } else {
          container.registerValue(
            TOKENS.EmbeddingsProvider,
            new testing.MockEmbeddingsProvider(embDims),
          );
        }

        // Immagini: Stability su Bedrock se configurato, altrimenti mock.
        const media = config.get('media', { infer: true });
        if (providers.image === 'bedrock') {
          container.registerValue(
            TOKENS.ImageProvider,
            new BedrockImageProvider({
              modelId: media.imageModelId,
              region: media.region,
              outputFormat: media.imageFormat,
              accessKeyId: bedrock.accessKeyId,
              secretAccessKey: bedrock.secretAccessKey,
              sessionToken: bedrock.sessionToken,
            }),
          );
        } else {
          container.registerValue(TOKENS.ImageProvider, new testing.MockImageProvider());
        }

        // Audio: Polly se configurato, altrimenti mock.
        if (providers.speech === 'polly') {
          container.registerValue(
            TOKENS.SpeechProvider,
            new PollySpeechProvider({
              region: media.region,
              engine: media.speechEngine,
              defaultVoice: media.speechDefaultVoice,
              accessKeyId: bedrock.accessKeyId,
              secretAccessKey: bedrock.secretAccessKey,
              sessionToken: bedrock.sessionToken,
            }),
          );
        } else {
          container.registerValue(TOKENS.SpeechProvider, new testing.MockSpeechProvider());
        }

        // Trascrizione (ASR): Amazon Transcribe se configurato, altrimenti mock.
        if (providers.transcription === 'transcribe') {
          const s3cfg = config.get('s3', { infer: true });
          const tr = config.get('transcribe', { infer: true });
          container.registerValue(
            TOKENS.TranscriptionProvider,
            new TranscribeProvider({
              region: tr.region,
              inputBucket: s3cfg.bucket,
              defaultLanguage: tr.defaultLanguage,
              accessKeyId: bedrock.accessKeyId,
              secretAccessKey: bedrock.secretAccessKey,
              sessionToken: bedrock.sessionToken,
            }),
          );
        } else {
          container.registerValue(TOKENS.TranscriptionProvider, new testing.MockTranscriptionProvider());
        }

        // Vector store: pgvector reale se configurato, altrimenti in-memory.
        if (providers.vectorStore === 'pgvector') {
          container.registerValue(
            TOKENS.VectorStore,
            new PgVectorStore({
              connectionString: config.get('databaseUrl', { infer: true }),
            }),
          );
        } else {
          container.registerValue(TOKENS.VectorStore, new testing.InMemoryVectorStore());
        }

        // Object storage: S3/MinIO reale se configurato, altrimenti locale.
        if (providers.objectStorage === 's3') {
          const s3 = config.get('s3', { infer: true });
          container.registerValue(
            TOKENS.ObjectStorage,
            new S3ObjectStorage({
              bucket: s3.bucket,
              region: s3.region,
              endpoint: s3.endpoint,
              publicEndpoint: s3.publicEndpoint,
              accessKeyId: s3.accessKeyId,
              secretAccessKey: s3.secretAccessKey,
            }),
          );
        } else {
          container.registerValue(TOKENS.ObjectStorage, new testing.LocalObjectStorage());
        }

        // Job queue: SQS reale se configurato, altrimenti in-memory.
        if (providers.jobQueue === 'sqs') {
          const sqs = config.get('sqs', { infer: true });
          container.registerValue(
            TOKENS.JobQueue,
            new SqsJobQueue({
              queueUrl: sqs.queueUrl,
              region: sqs.region,
              endpoint: sqs.endpoint,
            }),
          );
        } else {
          // background:true → i job girano DOPO la risposta HTTP (coda async
          // reale emulata in sviluppo), così gli endpoint di generazione non
          // bloccano la request in attesa del modello.
          container.registerValue(
            TOKENS.JobQueue,
            new testing.InMemoryJobQueue({ background: true }),
          );
        }

        // Estrattori documentali reali (PDF/DOCX/PPTX/XLSX/TXT/MD/HTML/CSV).
        container.registerValue(TOKENS.DocumentExtractors, createDefaultExtractors());

        return container;
      },
    },
    ...providerBindings,
  ],
  exports: [
    DOMAIN_CONTAINER,
    OBJECT_STORAGE,
    VECTOR_STORE,
    EMBEDDINGS_PROVIDER,
    LLM_PROVIDER,
    IMAGE_PROVIDER,
    SPEECH_PROVIDER,
    TRANSCRIPTION_PROVIDER,
    JOB_QUEUE,
    DOCUMENT_EXTRACTORS,
  ],
})
export class ProvidersModule {}
