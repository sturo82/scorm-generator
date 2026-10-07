-- Brand primario del corso (Blocco H — branding per corso): pilota colori, logo
-- e accenti nell'anteprima web e come default nell'export SCORM. Nullable; se il
-- brand viene eliminato la FK va a NULL (il corso resta, perde il brand primario).
ALTER TABLE "Course" ADD COLUMN "primaryBrandId" TEXT;

ALTER TABLE "Course"
  ADD CONSTRAINT "Course_primaryBrandId_fkey"
  FOREIGN KEY ("primaryBrandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Course_primaryBrandId_idx" ON "Course" ("primaryBrandId");
