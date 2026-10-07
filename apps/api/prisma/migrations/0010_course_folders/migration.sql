-- Organizzazione dei corsi in cartelle annidabili (self-relation).
-- Folder ha tenantId diretto => protetto da RLS come le altre tabelle
-- tenant-scoped. Course guadagna folderId (null = radice).

CREATE TABLE "Folder" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "parentId"  TEXT,
  "position"  INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Folder_tenantId_parentId_name_key" ON "Folder" ("tenantId", "parentId", "name");
CREATE INDEX "Folder_tenantId_idx" ON "Folder" ("tenantId");
CREATE INDEX "Folder_tenantId_parentId_idx" ON "Folder" ("tenantId", "parentId");

ALTER TABLE "Folder"
  ADD CONSTRAINT "Folder_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Folder"
  ADD CONSTRAINT "Folder_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Course.folderId
ALTER TABLE "Course" ADD COLUMN "folderId" TEXT;
CREATE INDEX "Course_tenantId_folderId_idx" ON "Course" ("tenantId", "folderId");
ALTER TABLE "Course"
  ADD CONSTRAINT "Course_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS su Folder (tenantId diretto).
ALTER TABLE "Folder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Folder" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Folder"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());
