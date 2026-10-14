-- Punto focale verticale della copertina del corso (0-100, centro=50).
-- Applicato come object-position: 50% <N>% in anteprima e player SCORM per
-- evitare che la copertina venga tagliata male. Default 50 (centro) per i
-- corsi esistenti.
ALTER TABLE "Course" ADD COLUMN "coverPosition" INTEGER NOT NULL DEFAULT 50;
