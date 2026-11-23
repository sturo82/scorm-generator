-- Autore del corso: serve a dividere "i miei corsi" da quelli della company.
-- I corsi esistenti restano senza autore (NULL).
ALTER TABLE "Course" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Course"
  ADD CONSTRAINT "Course_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Course_tenantId_createdById_idx" ON "Course" ("tenantId", "createdById");
