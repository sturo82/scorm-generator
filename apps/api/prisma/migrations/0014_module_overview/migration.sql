-- Pagina riepilogativa del modulo: obiettivi didattici (JSONB array di stringhe)
-- e chiave S3 dell'immagine di copertina del modulo.
ALTER TABLE "Module" ADD COLUMN "objectives" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Module" ADD COLUMN "coverImageKey" TEXT;
