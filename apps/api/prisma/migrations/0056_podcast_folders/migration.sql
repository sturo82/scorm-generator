-- Cartelle anche per i podcast: Folder guadagna un tipo (corsi o podcast) e
-- Podcast guadagna folderId. Gli alberi sono separati per tipo.
CREATE TYPE "FolderKind" AS ENUM ('COURSE', 'PODCAST');
ALTER TABLE "Folder" ADD COLUMN "kind" "FolderKind" NOT NULL DEFAULT 'COURSE';
DROP INDEX "Folder_tenantId_parentId_name_key";
CREATE UNIQUE INDEX "Folder_tenantId_kind_parentId_name_key" ON "Folder" ("tenantId", "kind", "parentId", "name");
ALTER TABLE "Podcast" ADD COLUMN "folderId" TEXT;
CREATE INDEX "Podcast_tenantId_folderId_idx" ON "Podcast" ("tenantId", "folderId");
ALTER TABLE "Podcast"
  ADD CONSTRAINT "Podcast_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
