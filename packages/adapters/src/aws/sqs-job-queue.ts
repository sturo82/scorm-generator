import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import type {
  EnqueueOptions,
  JobEnvelope,
  JobHandler,
  JobId,
  JobQueue,
  JobType,
  RequestContext,
} from '@scorm/domain';

export interface SqsJobQueueOptions {
  queueUrl: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Attesa del long-polling in secondi (0-20). */
  waitTimeSeconds?: number;
}

interface SqsMessageBody<T> {
  type: JobType;
  payload: T;
  context: RequestContext;
  attempt: number;
}

/**
 * Adapter JobQueue su Amazon SQS (Requisito 4.4 / 10). Il producer invia i job
 * come messaggi; il consumer (startConsumer) effettua long-polling e li
 * dispatcha agli handler registrati, con eliminazione del messaggio solo in caso
 * di successo (at-least-once). Credenziali solo server-side.
 */
export class SqsJobQueue implements JobQueue {
  readonly id = 'sqs';
  private readonly client: SQSClient;
  private readonly queueUrl: string;
  private readonly waitTimeSeconds: number;
  private readonly handlers = new Map<JobType, JobHandler<unknown>>();
  private seq = 0;
  private running = false;

  constructor(opts: SqsJobQueueOptions) {
    this.queueUrl = opts.queueUrl;
    this.waitTimeSeconds = opts.waitTimeSeconds ?? 10;
    this.client = new SQSClient({
      region: opts.region ?? 'us-east-1',
      endpoint: opts.endpoint,
      credentials:
        opts.accessKeyId && opts.secretAccessKey
          ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey }
          : undefined,
    });
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
    const body: SqsMessageBody<T> = { type, payload, context, attempt: 0 };
    const res = await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(body),
        DelaySeconds: opts?.delaySec,
      }),
    );
    return res.MessageId ?? `sqs_${++this.seq}`;
  }

  /** Avvia il loop di consumo. Restituisce una funzione per fermarlo. */
  startConsumer(): () => void {
    this.running = true;
    void this.loop();
    return () => {
      this.running = false;
    };
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const res = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 5,
            WaitTimeSeconds: this.waitTimeSeconds,
          }),
        );
        const messages = res.Messages ?? [];
        for (const msg of messages) {
          await this.handleMessage(msg.Body, msg.ReceiptHandle);
        }
        // Evita il busy-loop quando il long-polling è disabilitato (waitTime=0)
        // o la coda è vuota: cede il controllo prima del ciclo successivo.
        if (messages.length === 0 && this.waitTimeSeconds === 0) {
          await delay(50);
        }
      } catch {
        // Errori transitori di rete: breve pausa e riprova.
        await delay(1000);
      }
    }
  }

  private async handleMessage(body?: string, receiptHandle?: string): Promise<void> {
    if (!body || !receiptHandle) return;
    let parsed: SqsMessageBody<unknown>;
    try {
      parsed = JSON.parse(body) as SqsMessageBody<unknown>;
    } catch {
      // Messaggio malformato: eliminalo per non bloccare la coda.
      await this.deleteMessage(receiptHandle);
      return;
    }
    const handler = this.handlers.get(parsed.type);
    if (!handler) return; // nessun handler: lascia scadere la visibility.

    const envelope: JobEnvelope<unknown> = {
      id: receiptHandle,
      type: parsed.type,
      payload: parsed.payload,
      context: parsed.context,
      attempt: parsed.attempt + 1,
    };
    try {
      await handler(envelope);
      // Successo: rimuovi il messaggio dalla coda.
      await this.deleteMessage(receiptHandle);
    } catch {
      // Fallimento: NON eliminare → SQS lo rende di nuovo visibile per il retry
      // (gestito dalla redrive policy / DLQ configurata sull'infrastruttura).
    }
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: receiptHandle }),
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
