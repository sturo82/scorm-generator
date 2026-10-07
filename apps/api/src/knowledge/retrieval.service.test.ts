import { describe, it, expect, vi } from 'vitest';
import type { EmbeddingsProvider, VectorMatch, VectorStore, VectorFilter } from '@scorm/domain';
import { RetrievalService } from './retrieval.service.js';
import { buildRetrievalQuery } from './query-builder.js';

function match(id: string, score: number, over?: Partial<VectorMatch>): VectorMatch {
  return {
    id,
    score,
    text: `text-${id}`,
    documentId: over?.documentId ?? `doc-${id}`,
    documentName: over?.documentName ?? `Doc ${id}`,
    section: over?.section,
  };
}

function makeService(opts: {
  global?: VectorMatch[];
  course?: VectorMatch[];
}): { service: RetrievalService; queryCalls: VectorFilter[] } {
  const queryCalls: VectorFilter[] = [];
  const embeddings = {
    id: 'mock',
    dimensions: 3,
    embed: async (texts: string[]) => texts.map(() => [1, 0, 0]),
  } as EmbeddingsProvider;

  const vectors = {
    id: 'fake',
    upsert: vi.fn(),
    deleteByDocument: vi.fn(),
    query: async (_s: unknown, _v: number[], _k: number, filter?: VectorFilter) => {
      queryCalls.push(filter ?? {});
      if (filter?.scope === 'course') return opts.course ?? [];
      return opts.global ?? [];
    },
  } as unknown as VectorStore;

  return { service: new RetrievalService(embeddings, vectors), queryCalls };
}

describe('RetrievalService', () => {
  it('inoltra la whitelist documentIds al vector store (global + course)', async () => {
    const { service, queryCalls } = makeService({ global: [match('a', 0.9)], course: [] });
    await service.retrieve({ tenantId: 't', courseId: 'c1', text: 'q', documentIds: ['d1', 'd2'] });
    // Entrambe le query (global e course) ricevono la whitelist.
    expect(queryCalls.length).toBe(2);
    for (const f of queryCalls) {
      expect(f.documentIds).toEqual(['d1', 'd2']);
    }
  });

  it('non imposta documentIds quando la whitelist è vuota (usa tutta la knowledge)', async () => {
    const { service, queryCalls } = makeService({ global: [match('a', 0.9)] });
    await service.retrieve({ tenantId: 't', text: 'q', documentIds: [] });
    expect(queryCalls[0]?.documentIds).toBeUndefined();
  });

  it('recupera solo lo scope globale senza courseId', async () => {
    const { service, queryCalls } = makeService({ global: [match('a', 0.9)] });
    const res = await service.retrieve({ tenantId: 't', text: 'q' });
    expect(res.chunks).toHaveLength(1);
    expect(queryCalls.some((f) => f.scope === 'course')).toBe(false);
  });

  it('combina globale e per-corso e ordina per score desc', async () => {
    const { service } = makeService({
      global: [match('g1', 0.5), match('g2', 0.7)],
      course: [match('c1', 0.9)],
    });
    const res = await service.retrieve({ tenantId: 't', courseId: 'c', text: 'q' });
    expect(res.chunks.map((c) => c.score)).toEqual([0.9, 0.7, 0.5]);
  });

  it('deduplica per id tenendo lo score più alto', async () => {
    const { service } = makeService({
      global: [match('dup', 0.4)],
      course: [match('dup', 0.8)],
    });
    const res = await service.retrieve({ tenantId: 't', courseId: 'c', text: 'q' });
    expect(res.chunks).toHaveLength(1);
    expect(res.chunks[0]?.score).toBe(0.8);
  });

  it('rispetta topK e minScore', async () => {
    const { service } = makeService({
      global: [match('a', 0.9), match('b', 0.2), match('c', 0.8)],
    });
    const res = await service.retrieve({ tenantId: 't', text: 'q', topK: 1, minScore: 0.5 });
    expect(res.chunks).toHaveLength(1);
    expect(res.chunks[0]?.id ?? res.chunks[0]?.score).toBeDefined();
    expect(res.chunks[0]?.score).toBe(0.9);
  });

  it('produce citazioni uniche per documento+sezione', async () => {
    const { service } = makeService({
      global: [
        match('a', 0.9, { documentId: 'd1', section: 'S1' }),
        match('b', 0.8, { documentId: 'd1', section: 'S1' }), // stesso doc+sezione
        match('c', 0.7, { documentId: 'd1', section: 'S2' }),
      ],
    });
    const res = await service.retrieve({ tenantId: 't', text: 'q' });
    expect(res.citations).toHaveLength(2);
    expect(res.citations[0]).toEqual({ documentId: 'd1', documentName: 'Doc a', section: 'S1' });
  });
});

describe('buildRetrievalQuery', () => {
  it('combina obiettivo, corso, pubblico e temi', () => {
    const q = buildRetrievalQuery({
      objective: 'Riconoscere i rischi',
      courseTitle: 'Sicurezza',
      audience: 'Neoassunti',
      keywords: ['antincendio', 'DPI'],
    });
    expect(q).toContain('Riconoscere i rischi');
    expect(q).toContain('Corso: Sicurezza');
    expect(q).toContain('Pubblico: Neoassunti');
    expect(q).toContain('antincendio, DPI');
  });

  it('funziona col solo obiettivo', () => {
    expect(buildRetrievalQuery({ objective: 'X' })).toBe('X');
  });
});
