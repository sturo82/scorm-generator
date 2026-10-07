// pg è CommonJS: sotto ESM/NodeNext va importato come default e destrutturato
// (i named export non sono garantiti).
import pg from 'pg';
import type { PoolClient, Pool as PoolType } from 'pg';
import type {
  TenantScope,
  VectorFilter,
  VectorItem,
  VectorMatch,
  VectorStore,
} from '@scorm/domain';

const { Pool } = pg;

export interface PgVectorStoreOptions {
  /** Pool pg condiviso, oppure connectionString per crearne uno interno. */
  pool?: PoolType;
  connectionString?: string;
}

/**
 * Adapter VectorStore su Postgres + pgvector (Requisito 3.4 / 10). Ogni
 * operazione:
 *  - gira in una transazione in cui imposta la GUC `app.current_tenant`, così la
 *    Row-Level Security applica l'isolamento (difesa in profondità);
 *  - include comunque il filtro esplicito `tenantId` nel WHERE (enforcement
 *    primario).
 * La similarità usa l'operatore coseno `<=>` di pgvector; lo score restituito è
 * 1 - distanza (1 = identico).
 */
export class PgVectorStore implements VectorStore {
  readonly id = 'pgvector';
  private readonly pool: PoolType;

  constructor(opts: PgVectorStoreOptions) {
    if (opts.pool) {
      this.pool = opts.pool;
    } else if (opts.connectionString) {
      this.pool = new Pool({ connectionString: opts.connectionString });
    } else {
      throw new Error('PgVectorStore richiede pool o connectionString');
    }
  }

  async upsert(scope: TenantScope, items: VectorItem[]): Promise<void> {
    if (items.length === 0) return;
    await this.withTenant(scope.tenantId, async (client) => {
      for (const item of items) {
        await client.query(
          `INSERT INTO "KnowledgeChunk"
             ("id","tenantId","documentId","documentName","scope","courseId","section","text","embedding")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::vector)
           ON CONFLICT ("id") DO UPDATE SET
             "documentName" = EXCLUDED."documentName",
             "scope"        = EXCLUDED."scope",
             "courseId"     = EXCLUDED."courseId",
             "section"      = EXCLUDED."section",
             "text"         = EXCLUDED."text",
             "embedding"    = EXCLUDED."embedding"`,
          [
            item.id,
            scope.tenantId,
            item.documentId,
            item.documentName,
            item.scope,
            item.courseId ?? null,
            item.section ?? null,
            item.text,
            toVectorLiteral(item.vector),
          ],
        );
      }
    });
  }

  async query(
    scope: TenantScope,
    vector: number[],
    k: number,
    filter?: VectorFilter,
  ): Promise<VectorMatch[]> {
    if (k <= 0) return [];
    return this.withTenant(scope.tenantId, async (client) => {
      const conditions: string[] = ['"tenantId" = $1'];
      const params: unknown[] = [scope.tenantId];
      if (filter?.scope) {
        params.push(filter.scope);
        conditions.push(`"scope" = $${params.length}`);
      }
      if (filter?.courseId) {
        params.push(filter.courseId);
        conditions.push(`"courseId" = $${params.length}`);
      }
      if (filter?.documentId) {
        params.push(filter.documentId);
        conditions.push(`"documentId" = $${params.length}`);
      }
      if (filter?.documentIds && filter.documentIds.length > 0) {
        params.push(filter.documentIds);
        conditions.push(`"documentId" = ANY($${params.length})`);
      }
      const vecParam = params.push(toVectorLiteral(vector));
      const kParam = params.push(k);

      const sql = `
        SELECT "id", "text", "documentId", "documentName", "section",
               1 - ("embedding" <=> $${vecParam}::vector) AS score
        FROM "KnowledgeChunk"
        WHERE ${conditions.join(' AND ')}
        ORDER BY "embedding" <=> $${vecParam}::vector ASC
        LIMIT $${kParam}`;

      const res = await client.query(sql, params);
      return res.rows.map((r) => ({
        id: r.id as string,
        score: Number(r.score),
        text: r.text as string,
        documentId: r.documentId as string,
        documentName: r.documentName as string,
        section: (r.section as string | null) ?? undefined,
      }));
    });
  }

  async listChunks(
    scope: TenantScope,
    filter?: VectorFilter,
    limit = 2000,
  ): Promise<import('@scorm/domain').KnowledgeChunkText[]> {
    return this.withTenant(scope.tenantId, async (client) => {
      const conditions: string[] = ['"tenantId" = $1'];
      const params: unknown[] = [scope.tenantId];
      if (filter?.scope) {
        params.push(filter.scope);
        conditions.push(`"scope" = $${params.length}`);
      }
      if (filter?.courseId) {
        params.push(filter.courseId);
        conditions.push(`"courseId" = $${params.length}`);
      }
      if (filter?.documentIds && filter.documentIds.length > 0) {
        params.push(filter.documentIds);
        conditions.push(`"documentId" = ANY($${params.length})`);
      }
      params.push(limit);
      // ORDER BY DETERMINISTICO: senza, Postgres restituisce un sottoinsieme
      // arbitrario quando le righe superano il LIMIT, e l'ordine varia tra
      // chiamate. Questo faceva divergere l'anteprima dal pacchetto SCORM
      // (set/ordine di chunk diversi → RAG incoerente). "id" come tie-breaker
      // garantisce un ordine totale stabile.
      const sql = `
        SELECT "id", "text", "documentId", "documentName", "section"
        FROM "KnowledgeChunk"
        WHERE ${conditions.join(' AND ')}
        ORDER BY "documentId" ASC, "section" ASC NULLS FIRST, "id" ASC
        LIMIT $${params.length}`;
      const res = await client.query(sql, params);
      return res.rows.map((r) => ({
        id: r.id as string,
        text: r.text as string,
        documentId: r.documentId as string,
        documentName: r.documentName as string,
        section: (r.section as string | null) ?? undefined,
      }));
    });
  }

  async deleteByDocument(scope: TenantScope, documentId: string): Promise<void> {
    await this.withTenant(scope.tenantId, async (client) => {
      await client.query(
        `DELETE FROM "KnowledgeChunk" WHERE "tenantId" = $1 AND "documentId" = $2`,
        [scope.tenantId, documentId],
      );
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Esegue il callback in una transazione con la GUC `app.current_tenant`
   * impostata, così la RLS filtra per tenant. set_config con is_local=true
   * limita l'effetto alla transazione.
   */
  private async withTenant<T>(
    tenantId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

/** Formatta un array di numeri come literal pgvector: "[1,2,3]". */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
