import { type Container, TOKENS } from '@scorm/domain';
import { InMemoryJobQueue, type InMemoryJobQueueOptions } from './in-memory-job-queue.js';
import { InMemoryVectorStore } from './in-memory-vector-store.js';
import { LocalObjectStorage } from './local-object-storage.js';
import { MockEmbeddingsProvider } from './mock-embeddings-provider.js';
import { MockLLMProvider, type MockLLMOptions } from './mock-llm-provider.js';

export interface RegisterTestingOptions {
  llm?: MockLLMOptions;
  embeddingDimensions?: number;
  jobQueue?: InMemoryJobQueueOptions;
}

/**
 * Registra tutti gli adapter mock/in-memory sul container DI, per esercitare la
 * pipeline end-to-end in sviluppo e test senza provider esterni (Requisito 10).
 */
export function registerTestingAdapters(
  container: Container,
  opts: RegisterTestingOptions = {},
): Container {
  return container
    .registerValue(TOKENS.LLMProvider, new MockLLMProvider(opts.llm))
    .registerValue(
      TOKENS.EmbeddingsProvider,
      new MockEmbeddingsProvider(opts.embeddingDimensions),
    )
    .registerValue(TOKENS.VectorStore, new InMemoryVectorStore())
    .registerValue(TOKENS.ObjectStorage, new LocalObjectStorage())
    .registerValue(TOKENS.JobQueue, new InMemoryJobQueue(opts.jobQueue))
    .registerValue(TOKENS.DocumentExtractors, []);
}
