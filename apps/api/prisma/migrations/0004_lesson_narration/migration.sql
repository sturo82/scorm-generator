-- Narrazione audio della lezione (TTS, Requisito 4.2 / 5.5): chiave S3 del file
-- MP3 generato. L'URL firmato per la riproduzione è risolto a runtime.
ALTER TABLE "Lesson" ADD COLUMN "narrationKey" TEXT;
