-- Cache degli embeddings neurali dei chunk RAG di un corso.
-- Il calcolo (MiniLM su ~1000 chunk) costa minuti: senza cache l'anteprima
-- resta sul lessicale per diversi minuti a ogni apertura e ogni export
-- ricalcola da zero. La cache memorizza i vettori int8 (stessi byte del
-- pacchetto SCORM) e un `contentHash` del contenuto dei chunk: se il contenuto
-- cambia, l'hash cambia e si ricalcola; altrimenti si riusa (risposta in ms).

CREATE TABLE "RagEmbeddingCache" (
  "courseId"    TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "model"       TEXT NOT NULL,
  "dim"         INTEGER NOT NULL,
  "count"       INTEGER NOT NULL,
  "embeddings"  BYTEA NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RagEmbeddingCache_pkey" PRIMARY KEY ("courseId")
);

CREATE INDEX "RagEmbeddingCache_tenantId_idx" ON "RagEmbeddingCache" ("tenantId");

ALTER TABLE "RagEmbeddingCache"
  ADD CONSTRAINT "RagEmbeddingCache_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: isolamento per tenant come le altre tabelle con tenantId diretto.
ALTER TABLE "RagEmbeddingCache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RagEmbeddingCache" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RagEmbeddingCache"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());
