-- Tracciamento per-lezione e aggregazione dei job di generazione.
--  - lessonId: ricollega un job attivo alla lezione dopo un reload della UI.
--  - indice (tenantId, status): per l'elenco tenant-wide dei job attivi
--    (badge "in generazione" nella lista corsi), senza full scan.

ALTER TABLE "GenerationJob" ADD COLUMN "lessonId" TEXT;

CREATE INDEX "GenerationJob_tenantId_status_idx" ON "GenerationJob" ("tenantId", "status");
