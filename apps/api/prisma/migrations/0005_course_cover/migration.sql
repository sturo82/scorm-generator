-- Immagine di copertina del corso (Requisito 4.2 / 5): chiave S3 dell'immagine
-- generata. L'URL firmato per la visualizzazione è risolto a runtime.
ALTER TABLE "Course" ADD COLUMN "coverImageKey" TEXT;
