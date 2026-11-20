-- Dichiarazione di consenso registrata alla creazione di un avatar da una persona reale (foto o
-- digital twin). HeyGen non tiene alcun registro per gli avatar da foto: la responsabilità di
-- avere il consenso e di conservarne traccia è del cliente.
CREATE TABLE "AvatarConsentRecord" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "groupId"     TEXT NOT NULL,
  "avatarName"  TEXT NOT NULL,
  "kind"        TEXT NOT NULL,
  "attestedBy"  TEXT,
  "attestedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AvatarConsentRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AvatarConsentRecord_tenantId_groupId_key" ON "AvatarConsentRecord" ("tenantId", "groupId");
ALTER TABLE "AvatarConsentRecord"
  ADD CONSTRAINT "AvatarConsentRecord_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvatarConsentRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AvatarConsentRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AvatarConsentRecord"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());
