-- Brand predefinito del tenant: applicato ai corsi nuovi e a quelli senza un brand scelto.
ALTER TABLE "Tenant" ADD COLUMN "defaultBrandId" TEXT;
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_defaultBrandId_fkey"
  FOREIGN KEY ("defaultBrandId") REFERENCES "Brand" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- I tenant con un solo brand lo usano già come predefinito.
UPDATE "Tenant" t SET "defaultBrandId" = b.id
FROM (SELECT "tenantId", MIN(id) AS id FROM "Brand" GROUP BY "tenantId" HAVING COUNT(*) = 1) b
WHERE b."tenantId" = t.id AND t."defaultBrandId" IS NULL;
