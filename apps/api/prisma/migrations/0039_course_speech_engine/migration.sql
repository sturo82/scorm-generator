-- Preferenza del motore di sintesi vocale (Polly) per la narrazione del corso:
-- "standard" (economico) o "neural" (qualità superiore, più costoso). NULL =
-- eredita il default dell'ambiente (SPEECH_ENGINE). Nullable: i corsi esistenti
-- continuano a usare il default ambiente finché l'autore non sceglie.
ALTER TABLE "Course" ADD COLUMN "speechEngine" TEXT;
