import { createToken } from './container.js';
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
} from './ports/index.js';

/**
 * Token DI per le porte provider-agnostiche. Gli adapter concreti (Bedrock,
 * pgvector, S3, SQS, ...) vengono registrati su questi token in fase di
 * composizione dell'applicazione (Requisito 10.3).
 */
export const TOKENS = {
  LLMProvider: createToken<LLMProvider>('LLMProvider'),
  EmbeddingsProvider: createToken<EmbeddingsProvider>('EmbeddingsProvider'),
  ImageProvider: createToken<ImageProvider>('ImageProvider'),
  SpeechProvider: createToken<SpeechProvider>('SpeechProvider'),
  TranscriptionProvider: createToken<TranscriptionProvider>('TranscriptionProvider'),
  VectorStore: createToken<VectorStore>('VectorStore'),
  ObjectStorage: createToken<ObjectStorage>('ObjectStorage'),
  JobQueue: createToken<JobQueue>('JobQueue'),
  /** Più extractor possono essere registrati; qui il registro aggregato. */
  DocumentExtractors: createToken<DocumentExtractor[]>('DocumentExtractors'),
} as const;
