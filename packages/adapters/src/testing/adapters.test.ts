import { describe, it, expect } from 'vitest';
import { Container, TOKENS, type RequestContext } from '@scorm/domain';
import { CourseOutline, outlineJsonSchema, Assessment, assessmentJsonSchema } from '@scorm/contracts';
import {
  MockLLMProvider,
  MockEmbeddingsProvider,
  InMemoryVectorStore,
  LocalObjectStorage,
  InMemoryJobQueue,
  registerTestingAdapters,
} from './index.js';

describe('MockLLMProvider', () => {
  it('senza schema restituisce un eco deterministico con usage', async () => {
    const llm = new MockLLMProvider();
    const r = await llm.generate({ messages: [{ role: 'user', content: 'ciao' }] });
    expect(r.text).toContain('MOCK:');
    expect(r.model).toBe('mock-model');
    expect(r.usage.outputTokens).toBeGreaterThan(0);
  });

  it('con lo schema CourseOutline produce JSON che supera la validazione Zod', async () => {
    const llm = new MockLLMProvider();
    const r = await llm.generate({
      messages: [{ role: 'user', content: 'genera outline' }],
      schema: outlineJsonSchema as Record<string, unknown>,
    });
    const parsed = CourseOutline.safeParse(JSON.parse(r.text));
    expect(parsed.success, JSON.stringify(parsed, null, 2)).toBe(true);
  });

  it('con lo schema Assessment produce JSON valido (discriminated union risolta)', async () => {
    const llm = new MockLLMProvider();
    const r = await llm.generate({
      messages: [{ role: 'user', content: 'genera test' }],
      schema: assessmentJsonSchema as Record<string, unknown>,
    });
    const parsed = Assessment.safeParse(JSON.parse(r.text));
    expect(parsed.success, JSON.stringify(parsed, null, 2)).toBe(true);
  });

  it('rispetta un responder di override', async () => {
    const llm = new MockLLMProvider({ responder: () => 'FORZATO' });
    const r = await llm.generate({ messages: [{ role: 'user', content: 'x' }] });
    expect(r.text).toBe('FORZATO');
  });
});

describe('MockEmbeddingsProvider', () => {
  it('è deterministico e normalizzato', async () => {
    const emb = new MockEmbeddingsProvider(32);
    const [a] = await emb.embed(['sicurezza sul lavoro']);
    const [b] = await emb.embed(['sicurezza sul lavoro']);
    expect(a).toEqual(b);
    expect(a).toHaveLength(32);
  });
});

describe('InMemoryVectorStore', () => {
  const emb = new MockEmbeddingsProvider(64);
  const tenantA = { tenantId: 'A' };
  const tenantB = { tenantId: 'B' };

  it('isola i dati per tenant', async () => {
    const vs = new InMemoryVectorStore();
    const [vec] = await emb.embed(['antincendio']);
    await vs.upsert(tenantA, [
      { id: '1', vector: vec!, text: 'antincendio', documentId: 'd1', documentName: 'doc', scope: 'global' },
    ]);
    const resB = await vs.query(tenantB, vec!, 5);
    expect(resB).toHaveLength(0);
    const resA = await vs.query(tenantA, vec!, 5);
    expect(resA).toHaveLength(1);
  });

  it('recupera i chunk più simili (RAG) e rispetta i filtri di scope', async () => {
    const vs = new InMemoryVectorStore();
    const texts = ['estintori e antincendio', 'ferie e permessi', 'uscite di emergenza'];
    const vecs = await emb.embed(texts);
    await vs.upsert(tenantA, [
      { id: '1', vector: vecs[0]!, text: texts[0]!, documentId: 'd1', documentName: 'sicurezza', scope: 'global' },
      { id: '2', vector: vecs[1]!, text: texts[1]!, documentId: 'd2', documentName: 'hr', scope: 'course', courseId: 'c1' },
      { id: '3', vector: vecs[2]!, text: texts[2]!, documentId: 'd3', documentName: 'sicurezza', scope: 'global' },
    ]);
    const [q] = await emb.embed(['antincendio estintori']);
    const top = await vs.query(tenantA, q!, 2, { scope: 'global' });
    expect(top.length).toBeGreaterThan(0);
    expect(top[0]?.id).toBe('1'); // il più simile
    expect(top.every((m) => m.id !== '2')).toBe(true); // escluso dallo scope
  });

  it('elimina gli embeddings di un documento', async () => {
    const vs = new InMemoryVectorStore();
    const [vec] = await emb.embed(['x']);
    await vs.upsert(tenantA, [
      { id: '1', vector: vec!, text: 'x', documentId: 'd1', documentName: 'doc', scope: 'global' },
      { id: '2', vector: vec!, text: 'x', documentId: 'd1', documentName: 'doc', scope: 'global' },
    ]);
    await vs.deleteByDocument(tenantA, 'd1');
    const res = await vs.query(tenantA, vec!, 5);
    expect(res).toHaveLength(0);
  });
});

describe('LocalObjectStorage', () => {
  it('salva, legge, firma e cancella', async () => {
    const s = new LocalObjectStorage();
    await s.putObject('k1', Buffer.from('hello'));
    expect(await s.exists('k1')).toBe(true);
    expect((await s.getObject('k1')).toString()).toBe('hello');
    const url = await s.getSignedUrl('k1', { expiresInSec: 60 });
    expect(url).toContain('mock-storage://');
    await s.deleteObject('k1');
    expect(await s.exists('k1')).toBe(false);
  });

  it('getObject lancia NotFound se la chiave non esiste', async () => {
    const s = new LocalObjectStorage();
    await expect(s.getObject('missing')).rejects.toThrow(/non trovata/i);
  });
});

describe('InMemoryJobQueue', () => {
  const ctx: RequestContext = { tenant: { tenantId: 'A' }, correlationId: 'corr-1' };

  it('elabora un job registrato', async () => {
    const q = new InMemoryJobQueue();
    const seen: string[] = [];
    q.register<{ msg: string }>('knowledge.ingest', async (job) => {
      seen.push(job.payload.msg);
    });
    await q.enqueue('knowledge.ingest', { msg: 'ok' }, ctx);
    expect(seen).toEqual(['ok']);
  });

  it('ritenta fino a maxAttempts e poi rilancia', async () => {
    const q = new InMemoryJobQueue({ defaultMaxAttempts: 3 });
    let attempts = 0;
    q.register('course.generate_outline', async () => {
      attempts++;
      throw new Error('boom');
    });
    await expect(
      q.enqueue('course.generate_outline', {}, ctx),
    ).rejects.toThrow('boom');
    expect(attempts).toBe(3);
  });

  it('in modalità background enqueue NON blocca: il job gira dopo', async () => {
    const q = new InMemoryJobQueue({ background: true });
    let done = false;
    q.register('course.generate_content', async () => {
      done = true;
    });
    await q.enqueue('course.generate_content', {}, ctx);
    // Subito dopo enqueue il job non è ancora stato eseguito (è schedulato).
    expect(done).toBe(false);
    // Dopo un tick, il drain in background lo elabora.
    await new Promise((r) => setTimeout(r, 10));
    expect(done).toBe(true);
  });
});

describe('registerTestingAdapters', () => {
  it('registra tutti gli adapter sul container', () => {
    const c = registerTestingAdapters(new Container());
    expect(c.resolve(TOKENS.LLMProvider).id).toBe('mock');
    expect(c.resolve(TOKENS.EmbeddingsProvider).id).toBe('mock');
    expect(c.resolve(TOKENS.VectorStore).id).toBe('in-memory');
    expect(c.resolve(TOKENS.ObjectStorage).id).toBe('local');
    expect(c.resolve(TOKENS.JobQueue).id).toBe('in-memory');
    expect(c.resolve(TOKENS.DocumentExtractors)).toEqual([]);
  });
});
