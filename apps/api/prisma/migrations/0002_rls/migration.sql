-- Row-Level Security (RLS) come difesa in profondità per l'isolamento tenant
-- (Requisito 1.2 / 12.5). Le policy filtrano le righe in base alla GUC
-- `app.current_tenant`, impostata per-transazione dall'applicazione
-- (TenantPrismaService.runInTenant). L'enforcement primario resta il filtro
-- applicativo esplicito; RLS impedisce letture/scritture cross-tenant anche in
-- caso di query che dimentichino il filtro.
--
-- Nota: la funzione helper legge la GUC in modalità "missing_ok" (true), così
-- un contesto senza tenant impostato risulta NULL e le policy negano l'accesso
-- alle tabelle protette.

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')
$$;

-- Tabelle con colonna tenantId diretta.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "User"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());

ALTER TABLE "Brand" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Brand" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Brand"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());

ALTER TABLE "Course" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Course" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Course"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());

ALTER TABLE "KnowledgeDoc" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeDoc" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "KnowledgeDoc"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());

ALTER TABLE "GenerationJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GenerationJob" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "GenerationJob"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());

ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditEvent"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());

-- Tenant: la riga stessa è identificata da id.
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Tenant"
  USING ("id" = app_current_tenant())
  WITH CHECK ("id" = app_current_tenant());

-- Tabelle figlie (Module, Lesson, Assessment, Question, CourseBrandBuild,
-- ScormPackage, ContentVersion) non hanno tenantId diretto: l'isolamento è
-- garantito dalle FK verso Course/Assessment/Build (già protette) e dal filtro
-- applicativo. Si evita qui una policy basata su sotto-query per non penalizzare
-- le performance; verranno valutate policy dedicate se necessario.
