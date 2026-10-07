import { describe, it, expect, vi } from 'vitest';
import { SqsJobQueue } from './sqs-job-queue.js';
import type { RequestContext } from '@scorm/domain';

const ctx: RequestContext = { tenant: { tenantId: 't1' }, correlationId: 'c1' };

/** Sostituisce il client SQS interno con un fake controllabile. */
function withFakeClient(q: SqsJobQueue, send: (cmd: unknown) => Promise<unknown>): void {
  (q as unknown as { client: { send: unknown } }).client = { send: vi.fn(send) };
}

describe('SqsJobQueue.enqueue', () => {
  it('serializza il job nel body del messaggio', async () => {
    const q = new SqsJobQueue({ queueUrl: 'http://q', waitTimeSeconds: 0 });
    let captured: { input: { MessageBody: string } } | undefined;
    withFakeClient(q, async (cmd) => {
      captured = cmd as { input: { MessageBody: string } };
      return { MessageId: 'm1' };
    });
    const id = await q.enqueue('knowledge.ingest', { documentId: 'd1' }, ctx);
    expect(id).toBe('m1');
    const body = JSON.parse(captured!.input.MessageBody);
    expect(body.type).toBe('knowledge.ingest');
    expect(body.payload.documentId).toBe('d1');
    expect(body.context.tenant.tenantId).toBe('t1');
  });
});

describe('SqsJobQueue consumer', () => {
  it('dispatcha al handler ed elimina il messaggio in caso di successo', async () => {
    const q = new SqsJobQueue({ queueUrl: 'http://q', waitTimeSeconds: 0 });
    const deleted: string[] = [];
    const handled: unknown[] = [];
    withFakeClient(q, async (cmd) => {
      const c = cmd as { constructor: { name: string }; input: Record<string, unknown> };
      if (c.constructor.name === 'ReceiveMessageCommand') {
        return {
          Messages: handled.length === 0
            ? [{ Body: JSON.stringify({ type: 'knowledge.ingest', payload: { x: 1 }, context: ctx, attempt: 0 }), ReceiptHandle: 'rh1' }]
            : [],
        };
      }
      if (c.constructor.name === 'DeleteMessageCommand') {
        deleted.push(c.input.ReceiptHandle as string);
      }
      return {};
    });

    q.register('knowledge.ingest', async (job) => {
      handled.push(job.payload);
    });

    const stop = q.startConsumer();
    // Attende qualche tick per lasciar girare il loop asincrono.
    await new Promise((r) => setTimeout(r, 50));
    stop();

    expect(handled).toHaveLength(1);
    expect(deleted).toContain('rh1');
  });

  it('NON elimina il messaggio se il handler fallisce (retry via SQS)', async () => {
    const q = new SqsJobQueue({ queueUrl: 'http://q', waitTimeSeconds: 0 });
    const deleted: string[] = [];
    let served = false;
    withFakeClient(q, async (cmd) => {
      const c = cmd as { constructor: { name: string }; input: Record<string, unknown> };
      if (c.constructor.name === 'ReceiveMessageCommand') {
        if (served) return { Messages: [] };
        served = true;
        return { Messages: [{ Body: JSON.stringify({ type: 'course.export', payload: {}, context: ctx, attempt: 0 }), ReceiptHandle: 'rh2' }] };
      }
      if (c.constructor.name === 'DeleteMessageCommand') deleted.push(c.input.ReceiptHandle as string);
      return {};
    });

    q.register('course.export', async () => {
      throw new Error('boom');
    });

    const stop = q.startConsumer();
    await new Promise((r) => setTimeout(r, 50));
    stop();

    expect(deleted).not.toContain('rh2');
  });
});
