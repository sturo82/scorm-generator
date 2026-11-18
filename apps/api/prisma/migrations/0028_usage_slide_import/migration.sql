-- Import "video da slide" a cui attribuire il consumo: permette di mostrare il costo di
-- generazione di ogni video (anche di libreria, che non ha un corso).
ALTER TABLE "UsageRecord" ADD COLUMN "slideImportId" TEXT;
CREATE INDEX "UsageRecord_slideImportId_idx" ON "UsageRecord" ("slideImportId");

-- Recupero dei consumi già registrati per l'unico video di libreria creato prima di questa
-- colonna: consumi da slide senza corso dello stesso tenant (nessun effetto altrove).
UPDATE "UsageRecord"
SET "slideImportId" = 'b460d8ca-4683-4a1b-b2b9-95466a7f5a04'
WHERE "slideImportId" IS NULL
  AND "courseId" IS NULL
  AND "source" LIKE 'slide\_%'
  AND "tenantId" = (SELECT "tenantId" FROM "VideoAsset" WHERE "id" = 'cmwksrpiw000v7vjpo8hra61a');
