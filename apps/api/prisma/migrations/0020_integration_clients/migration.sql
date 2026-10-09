-- Integrazioni B2B (accesso macchina-a-macchina) + opt-in condivisione corsi.
--
-- 1) Opt-in di condivisione sul corso: solo i corsi con shareable=true (e stato
--    editoriale APPROVED, controllato a livello applicativo) sono esposti al
--    catalogo delle integrazioni.
ALTER TABLE "Course" ADD COLUMN "shareable" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Course_tenantId_shareable_idx" ON "Course" ("tenantId", "shareable");

-- 2) Stato di un client di integrazione.
CREATE TYPE "IntegrationClientStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- 3) Client di integrazione: credenziali client-credentials per piattaforme
--    terze autorizzate dal tenant. Si conserva solo l'hash del secret.
CREATE TABLE "IntegrationClient" (
  "id"         TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "clientId"   TEXT NOT NULL,
  "secretHash" TEXT NOT NULL,
  "scopes"     TEXT[],
  "status"     "IntegrationClientStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastUsedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationClient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationClient_clientId_key" ON "IntegrationClient" ("clientId");
CREATE INDEX "IntegrationClient_tenantId_idx" ON "IntegrationClient" ("tenantId");
CREATE INDEX "IntegrationClient_tenantId_status_idx" ON "IntegrationClient" ("tenantId", "status");

ALTER TABLE "IntegrationClient"
  ADD CONSTRAINT "IntegrationClient_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4) Row-Level Security coerente con le altre tabelle a tenantId diretto
--    (difesa in profondità sopra al filtro applicativo). La GUC
--    app.current_tenant è impostata da TenantPrismaService.runInTenant.
ALTER TABLE "IntegrationClient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationClient" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IntegrationClient"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());
