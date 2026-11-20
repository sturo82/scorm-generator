-- Appartenenza degli avatar HeyGen (account unico condiviso): tenant proprietario ed eventuale
-- elenco di utenti ammessi. Gli avatar senza riga appartengono al tenant della piattaforma.
CREATE TABLE "AvatarAccess" (
  "groupId"   TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "createdBy" TEXT,
  "userIds"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AvatarAccess_pkey" PRIMARY KEY ("groupId")
);
CREATE INDEX "AvatarAccess_tenantId_idx" ON "AvatarAccess" ("tenantId");
ALTER TABLE "AvatarAccess"
  ADD CONSTRAINT "AvatarAccess_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
