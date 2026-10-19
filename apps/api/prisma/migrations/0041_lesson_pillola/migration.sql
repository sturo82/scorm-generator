-- Lezione "pillola": layout dedicato (contenitore scorrevole, card per blocco,
-- contenuto/azioni distinti). Deriva da Brief.format === 'pillole'. Default false
-- per le lezioni esistenti (restano rese come concetti standard).
ALTER TABLE "Lesson" ADD COLUMN "pillola" BOOLEAN NOT NULL DEFAULT false;
