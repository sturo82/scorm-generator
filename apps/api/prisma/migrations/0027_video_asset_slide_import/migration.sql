-- Import "video da slide" da cui è stato creato un video di libreria: permette di riaprire
-- copioni, clip e montaggio dal video stesso.
ALTER TABLE "VideoAsset" ADD COLUMN "slideImportId" TEXT;

-- Recupero dell'unico video di libreria creato prima di questa colonna (nessun effetto altrove).
UPDATE "VideoAsset"
SET "slideImportId" = 'b460d8ca-4683-4a1b-b2b9-95466a7f5a04'
WHERE "id" = 'cmwksrpiw000v7vjpo8hra61a' AND "slideImportId" IS NULL;
