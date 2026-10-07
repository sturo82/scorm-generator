import type {
  KnowledgeChunkText,
  TenantScope,
  VectorFilter,
  VectorItem,
  VectorMatch,
  VectorStore,
} from '@scorm/domain';

/**
 * VectorStore in-memory per sviluppo e test. Isola i dati per tenant e supporta
 * i filtri per scope/corso/documento (Requisito 1.2 / 3.5). Usa similarità
 * coseno. NON per produzione.
 */
export class InMemoryVectorStore implements VectorStore {
  readonly id = 'in-memory';

  /** Mappa tenantId -> (itemId -> item). */
  private readonly store = new Map<string, Map<string, VectorItem>>();

  async upsert(scope: TenantScope, items: VectorItem[]): Promise<void> {
    const bucket = this.bucket(scope.tenantId);
    for (const item of items) {
      bucket.set(item.id, { ...item });
    }
  }

  async query(
    scope: TenantScope,
    vector: number[],
    k: number,
    filter?: VectorFilter,
  ): Promise<VectorMatch[]> {
    const bucket = this.store.get(scope.tenantId);
    if (!bucket) return [];

    const matches: VectorMatch[] = [];
    for (const item of bucket.values()) {
      if (!this.passesFilter(item, filter)) continue;
      matches.push({
        id: item.id,
        score: cosineSimilarity(vector, item.vector),
        text: item.text,
        documentId: item.documentId,
        documentName: item.documentName,
        section: item.section,
      });
    }
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, Math.max(0, k));
  }

  async listChunks(
    scope: TenantScope,
    filter?: VectorFilter,
    limit = 2000,
  ): Promise<KnowledgeChunkText[]> {
    const bucket = this.store.get(scope.tenantId);
    if (!bucket) return [];
    const out: KnowledgeChunkText[] = [];
    for (const item of bucket.values()) {
      if (!this.passesFilter(item, filter)) continue;
      out.push({
        id: item.id,
        text: item.text,
        documentId: item.documentId,
        documentName: item.documentName,
        section: item.section,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  async deleteByDocument(scope: TenantScope, documentId: string): Promise<void> {
    const bucket = this.store.get(scope.tenantId);
    if (!bucket) return;
    for (const [id, item] of bucket) {
      if (item.documentId === documentId) bucket.delete(id);
    }
  }

  private bucket(tenantId: string): Map<string, VectorItem> {
    let b = this.store.get(tenantId);
    if (!b) {
      b = new Map();
      this.store.set(tenantId, b);
    }
    return b;
  }

  private passesFilter(item: VectorItem, filter?: VectorFilter): boolean {
    if (!filter) return true;
    if (filter.scope && item.scope !== filter.scope) return false;
    if (filter.courseId && item.courseId !== filter.courseId) return false;
    if (filter.documentId && item.documentId !== filter.documentId) return false;
    if (filter.documentIds && filter.documentIds.length > 0 && !filter.documentIds.includes(item.documentId)) {
      return false;
    }
    return true;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const av = a[i] as number;
    const bv = b[i] as number;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
