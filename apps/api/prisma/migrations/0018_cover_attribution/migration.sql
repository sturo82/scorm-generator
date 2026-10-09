-- Attribuzione della copertina quando proviene da una libreria stock
-- (Unsplash/Pexels): credito obbligatorio dell'autore e della fonte, salvato
-- come JSONB accanto alla chiave S3 dell'immagine. Null per le copertine
-- generate dall'AI o caricate manualmente.
ALTER TABLE "Course" ADD COLUMN "coverAttribution" JSONB;
ALTER TABLE "Module" ADD COLUMN "coverAttribution" JSONB;
