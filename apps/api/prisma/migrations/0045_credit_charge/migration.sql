-- Crediti addebitati sul wallet di Manager, uno per capture: servono a mostrare al cliente quanto
-- gli è costato un corso (o un video da slide) in crediti, senza esporre i costi dei fornitori.
CREATE TABLE "CreditCharge" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "courseId"      TEXT,
  "slideImportId" TEXT,
  "feature"       TEXT NOT NULL,
  "units"         DOUBLE PRECISION,
  "credits"       INTEGER NOT NULL,
  "walletId"      TEXT NOT NULL,
  "payer"         TEXT NOT NULL,
  "reference"     TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditCharge_pkey" PRIMARY KEY ("id")
);
-- Una riga per hold: un secondo settle dello stesso hold non duplica l'addebito.
CREATE UNIQUE INDEX "CreditCharge_reference_feature_key" ON "CreditCharge" ("reference", "feature");
CREATE INDEX "CreditCharge_tenantId_courseId_idx" ON "CreditCharge" ("tenantId", "courseId");
CREATE INDEX "CreditCharge_tenantId_slideImportId_idx" ON "CreditCharge" ("tenantId", "slideImportId");
ALTER TABLE "CreditCharge"
  ADD CONSTRAINT "CreditCharge_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditCharge"
  ADD CONSTRAINT "CreditCharge_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditCharge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditCharge" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CreditCharge"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());
