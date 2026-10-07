-- Tabella degli embeddings dei chunk della knowledge base (Requisito 3.4).
-- Gestita con SQL raw perché Prisma non modella nativamente il tipo `vector`.
-- La colonna vector non ha dimensione fissa: la dimensione effettiva dipende
-- dall'EmbeddingsProvider attivo (mock=64, Bedrock=1024) ed è validata a livello
-- applicativo. Un indice per similarità verrà creato quando la dimensione sarà
-- stabile per deployment (gli indici HNSW/IVFFlat richiedono dimensione fissa).

CREATE TABLE "KnowledgeChunk" (
  "id"            TEXT PRIMARY KEY,
  "tenantId"      TEXT NOT NULL,
  "documentId"    TEXT NOT NULL,
  "documentName"  TEXT NOT NULL,
  "scope"         TEXT NOT NULL,
  "courseId"      TEXT,
  "section"       TEXT,
  "text"          TEXT NOT NULL,
  "embedding"     vector NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indici per filtro/isolamento (Requisito 1.2) e per la cancellazione per doc.
CREATE INDEX "KnowledgeChunk_tenantId_idx" ON "KnowledgeChunk" ("tenantId");
CREATE INDEX "KnowledgeChunk_tenantId_scope_idx" ON "KnowledgeChunk" ("tenantId", "scope");
CREATE INDEX "KnowledgeChunk_documentId_idx" ON "KnowledgeChunk" ("documentId");

-- Chiave esterna verso KnowledgeDoc per rimuovere i chunk se il documento è
-- eliminato dal DB (oltre alla rimozione esplicita via adapter).
ALTER TABLE "KnowledgeChunk"
  ADD CONSTRAINT "KnowledgeChunk_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "KnowledgeDoc"("id") ON DELETE CASCADE;

-- Row-Level Security coerente con le altre tabelle tenant (difesa in profondità).
ALTER TABLE "KnowledgeChunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeChunk" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "KnowledgeChunk"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());
