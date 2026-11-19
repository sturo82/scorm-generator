-- Budget in crediti del corso: il preventivo confermato dall'utente. Una spesa che lo supererebbe
-- richiede una conferma esplicita (e alza il budget). Null = nessun budget (nessun controllo).
ALTER TABLE "Course" ADD COLUMN "creditBudget" INTEGER;
-- Opzioni scelte nel preventivo (video delle pillole, narrazione, video avatar, copertine dei moduli).
ALTER TABLE "Course" ADD COLUMN "estimateOptions" JSONB;

-- Riserve di crediti ancora aperte (hold su Manager non ancora catturati o liberati): servono a
-- contare nel budget anche i lavori in corso.
CREATE TABLE "CreditReservation" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "courseId"  TEXT,
  "credits"   INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt"  TIMESTAMP(3),
  CONSTRAINT "CreditReservation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CreditReservation_tenantId_courseId_idx" ON "CreditReservation" ("tenantId", "courseId");
ALTER TABLE "CreditReservation"
  ADD CONSTRAINT "CreditReservation_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditReservation"
  ADD CONSTRAINT "CreditReservation_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditReservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditReservation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CreditReservation"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());
