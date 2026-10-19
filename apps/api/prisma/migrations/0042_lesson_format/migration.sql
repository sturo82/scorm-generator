-- Formato didattico della lezione (fonte di verità per-lezione):
-- 'pillola' | 'video_first' | 'standard'. Nullable: le lezioni storiche non lo
-- hanno e il formato si deriva dai flag videoFirst/pillola a runtime.
ALTER TABLE "Lesson" ADD COLUMN "format" TEXT;

-- Backfill: allinea il formato ai flag esistenti per i corsi già generati, così
-- l'editor per-lezione parte da un valore coerente (pillola ha precedenza).
UPDATE "Lesson" SET "format" = 'pillola' WHERE "pillola" = true;
UPDATE "Lesson" SET "format" = 'video_first' WHERE "pillola" = false AND "videoFirst" = true;
UPDATE "Lesson" SET "format" = 'standard' WHERE "format" IS NULL;
