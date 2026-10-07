import { type Provider } from '@nestjs/common';
import { Container, TOKENS } from '@scorm/domain';
import type {
  DocumentExtractor,
  EmbeddingsProvider,
  ImageProvider,
  JobQueue,
  LLMProvider,
  ObjectStorage,
  SpeechProvider,
  TranscriptionProvider,
  VectorStore,
} from '@scorm/domain';
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
 * Binding NestJS che risolvono le porte dal Container di dominio, così i servizi
 * possono iniettarle direttamente senza conoscere il container.
 */
export const providerBindings: Provider[] = [
  {
    provide: OBJECT_STORAGE,
    inject: [DOMAIN_CONTAINER],
    useFactory: (c: Container): ObjectStorage => c.resolve(TOKENS.ObjectStorage),
  },
  {
    provide: VECTOR_STORE,
    inject: [DOMAIN_CONTAINER],
    useFactory: (c: Container): VectorStore => c.resolve(TOKENS.VectorStore),
  },
  {
    provide: EMBEDDINGS_PROVIDER,
    inject: [DOMAIN_CONTAINER],
    useFactory: (c: Container): EmbeddingsProvider => c.resolve(TOKENS.EmbeddingsProvider),
  },
  {
    provide: LLM_PROVIDER,
    inject: [DOMAIN_CONTAINER],
    useFactory: (c: Container): LLMProvider => c.resolve(TOKENS.LLMProvider),
  },
  {
    provide: IMAGE_PROVIDER,
    inject: [DOMAIN_CONTAINER],
    useFactory: (c: Container): ImageProvider => c.resolve(TOKENS.ImageProvider),
  },
  {
    provide: SPEECH_PROVIDER,
    inject: [DOMAIN_CONTAINER],
    useFactory: (c: Container): SpeechProvider => c.resolve(TOKENS.SpeechProvider),
  },
  {
    provide: TRANSCRIPTION_PROVIDER,
    inject: [DOMAIN_CONTAINER],
    useFactory: (c: Container): TranscriptionProvider => c.resolve(TOKENS.TranscriptionProvider),
  },
  {
    provide: JOB_QUEUE,
    inject: [DOMAIN_CONTAINER],
    useFactory: (c: Container): JobQueue => c.resolve(TOKENS.JobQueue),
  },
  {
    provide: DOCUMENT_EXTRACTORS,
    inject: [DOMAIN_CONTAINER],
    useFactory: (c: Container): DocumentExtractor[] => c.resolve(TOKENS.DocumentExtractors),
  },
];

export {
  DOCUMENT_EXTRACTORS,
  DOMAIN_CONTAINER,
  OBJECT_STORAGE,
  VECTOR_STORE,
  EMBEDDINGS_PROVIDER,
  LLM_PROVIDER,
  IMAGE_PROVIDER,
  SPEECH_PROVIDER,
  JOB_QUEUE,
};
