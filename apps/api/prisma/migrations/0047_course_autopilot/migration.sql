-- Generazione automatica del corso (struttura, contenuti, test, copertina e componenti scelte nel
-- preventivo) in un unico lavoro sul server: stato, fase, opzioni ed eventuali problemi.
ALTER TABLE "Course" ADD COLUMN "autopilot" JSONB;
