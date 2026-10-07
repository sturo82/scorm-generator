import type { TenantScope } from '../tenant.js';

/**
 * Porta per il vector store usato dal RAG (default: pgvector) (Requisito 3 / 10).
 * Tutte le operazioni sono scoped per tenant per garantire l'isolamento
 * (Requisito 1.2).
 */

/** Ambito della knowledge: globale al tenant o specifica di un corso. */
export type KnowledgeScope = 'global' | 'course';

export interface VectorItem {
  /** Id stabile del chunk (idempotenza su upsert). */
  id: string;
  vector: number[];
  /** Testo originale del chunk, per il contesto RAG. */
  text: string;
  documentId: string;
  documentName: string;
  scope: KnowledgeScope;
  /** Presente quando scope === 'course'. */
  courseId?: string;
  section?: string;
}

export interface VectorFilter {
  scope?: KnowledgeScope;
  courseId?: string;
  /** Filtro per un singolo documento. */
  documentId?: string;
  /** Whitelist di documenti: se presente e non vuota, limita a questi id. */
  documentIds?: string[];
}

export interface VectorMatch {
  id: string;
  score: number;
  text: string;
  documentId: string;
  documentName: string;
  section?: string;
}

/** Chunk della knowledge senza vettore, per il RAG client-side (offline). */
export interface KnowledgeChunkText {
  id: string;
  text: string;
  documentId: string;
  documentName: string;
  section?: string;
}

export interface VectorStore {
  readonly id: string;
  upsert(scope: TenantScope, items: VectorItem[]): Promise<void>;
  query(
    scope: TenantScope,
    vector: number[],
    k: number,
    filter?: VectorFilter,
  ): Promise<VectorMatch[]>;
  /**
   * Elenca i chunk (solo testo + citazione, senza vettore) per impacchettare un
   * indice RAG lessicale offline nel pacchetto SCORM / anteprima. Rispetta il
   * filtro (scope/course/documentIds).
   */
  listChunks(scope: TenantScope, filter?: VectorFilter, limit?: number): Promise<KnowledgeChunkText[]>;
  /** Rimuove tutti gli embeddings di un documento (Requisito 3.7). */
  deleteByDocument(scope: TenantScope, documentId: string): Promise<void>;
}
