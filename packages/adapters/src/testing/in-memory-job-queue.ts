import type {
  EnqueueOptions,
  JobEnvelope,
  JobHandler,
  JobId,
  JobQueue,
  JobType,
  RequestContext,
} from '@scorm/domain';

/**
 * JobQueue in-memory per sviluppo e test. Elabora i job in modo asincrono ma
 * nello stesso processo, con retry fino a maxAttempts. Utile per test E2E della
 * pipeline senza SQS. NON per produzione.
 */
export interface InMemoryJobQueueOptions {
  /** Se true, i job vengono eseguiti subito; altrimenti su `drain()`. */
  autoProcess?: boolean;
  /**
   * Se true (e autoProcess attivo), il drain NON è atteso dentro `enqueue`: viene
   * schedulato su un tick successivo (setTimeout 0). Così `enqueue` ritorna
   * subito e l'handler gira dopo che la response HTTP è partita, emulando una
   * coda asincrona reale in sviluppo (nessun blocco della request). I test che
   * vogliono asserire sul risultato possono comunque chiamare `drain()`.
   */
  background?: boolean;
  defaultMaxAttempts?: number;
}

export class InMemoryJobQueue implements JobQueue {
  readonly id = 'in-memory';
  private readonly handlers = new Map<JobType, JobHandler<unknown>>();
  private readonly pending: JobEnvelope<unknown>[] = [];
  private seq = 0;
  private readonly autoProcess: boolean;
  private readonly background: boolean;
  private readonly defaultMaxAttempts: number;
  private draining = false;

  constructor(opts: InMemoryJobQueueOptions = {}) {
    this.autoProcess = opts.autoProcess ?? true;
    this.background = opts.background ?? false;
    this.defaultMaxAttempts = opts.defaultMaxAttempts ?? 3;
  }

  register<T>(type: JobType, handler: JobHandler<T>): void {
    this.handlers.set(type, handler as JobHandler<unknown>);
  }

  async enqueue<T>(
    type: JobType,
    payload: T,
    context: RequestContext,
    opts?: EnqueueOptions,
  ): Promise<JobId> {
    const id = `job_${++this.seq}`;
    const envelope: JobEnvelope<unknown> = { id, type, payload, context, attempt: 0 };
    this.pending.push(envelope);
    this.maxAttemptsById.set(id, opts?.maxAttempts ?? this.defaultMaxAttempts);
    if (this.autoProcess) {
      if (this.background) {
        // Non attendere: lascia tornare subito enqueue, poi elabora in un tick
        // successivo. Gli errori del drain in background sono silenziati (il
        // fallimento è registrato dall'handler stesso sul record del job).
        setTimeout(() => {
          void this.drain().catch(() => undefined);
        }, 0);
      } else {
        await this.drain();
      }
    }
    return id;
  }

  private readonly maxAttemptsById = new Map<JobId, number>();

  /**
   * Elabora tutti i job in coda. Rilancia l'ultimo errore se un job esaurisce i
   * tentativi, così i test possono asserire sui fallimenti. Il guard `draining`
   * evita drain concorrenti quando più enqueue in background li schedulano.
   */
  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    let lastError: unknown;
    try {
      while (this.pending.length > 0) {
        const job = this.pending.shift() as JobEnvelope<unknown>;
        const handler = this.handlers.get(job.type);
        if (!handler) continue;
        const maxAttempts = this.maxAttemptsById.get(job.id) ?? this.defaultMaxAttempts;
        try {
          await handler({ ...job, attempt: job.attempt + 1 });
        } catch (err) {
          lastError = err;
          if (job.attempt + 1 < maxAttempts) {
            this.pending.push({ ...job, attempt: job.attempt + 1 });
          }
        }
      }
    } finally {
      this.draining = false;
    }
    if (lastError) throw lastError;
  }

  get size(): number {
    return this.pending.length;
  }
}
