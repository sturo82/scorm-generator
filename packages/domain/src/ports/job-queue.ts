import type { RequestContext } from '../tenant.js';

/**
 * Porta per la coda dei job asincroni (ingestion, generazione, export).
 * Default: SQS (in dev: in-memory). Disaccoppia API e worker (Requisito 4.4).
 */

/** Tipi di job del dominio. */
export type JobType =
  | 'knowledge.ingest'
  | 'course.generate_outline'
  | 'course.generate_content'
  | 'course.generate_all_content'
  | 'course.generate_assessment'
  | 'course.export';

export type JobId = string;

export interface EnqueueOptions {
  /** Ritardo prima dell'elaborazione, in secondi. */
  delaySec?: number;
  /** Numero massimo di tentativi prima del fallimento definitivo. */
  maxAttempts?: number;
}

export interface JobEnvelope<T = unknown> {
  id: JobId;
  type: JobType;
  payload: T;
  context: RequestContext;
  attempt: number;
}

/** Handler registrato per un dato JobType. */
export type JobHandler<T = unknown> = (job: JobEnvelope<T>) => Promise<void>;

export interface JobQueue {
  readonly id: string;
  enqueue<T>(
    type: JobType,
    payload: T,
    context: RequestContext,
    opts?: EnqueueOptions,
  ): Promise<JobId>;
  /** Registra l'handler per un tipo di job (lato worker). */
  register<T>(type: JobType, handler: JobHandler<T>): void;
}
