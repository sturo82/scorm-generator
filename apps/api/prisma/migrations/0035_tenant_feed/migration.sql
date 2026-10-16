-- Feed RSS/Atom personalizzati salvati dal tenant, usati (in aggiunta o in
-- alternativa ai feed predefiniti) per creare corsi a partire da un argomento.
-- Additiva: nuova tabella, nessuna modifica distruttiva.
CREATE TABLE "TenantFeed" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "url"       TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantFeed_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantFeed_tenantId_url_key" ON "TenantFeed" ("tenantId", "url");
CREATE INDEX "TenantFeed_tenantId_idx" ON "TenantFeed" ("tenantId");

ALTER TABLE "TenantFeed"
  ADD CONSTRAINT "TenantFeed_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
