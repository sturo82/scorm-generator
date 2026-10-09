-- Ticket SSO monouso a vita breve: ponte sicuro per far entrare nella web app un
-- utente proveniente da una piattaforma terza (es. OnDemand), autenticata con la
-- sua API key (IntegrationClient + scope sso:issue). Si conserva solo l'hash.
CREATE TABLE "SsoTicket" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "clientId"  TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SsoTicket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SsoTicket_tokenHash_key" ON "SsoTicket" ("tokenHash");
CREATE INDEX "SsoTicket_tenantId_idx" ON "SsoTicket" ("tenantId");
CREATE INDEX "SsoTicket_expiresAt_idx" ON "SsoTicket" ("expiresAt");

ALTER TABLE "SsoTicket"
  ADD CONSTRAINT "SsoTicket_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SsoTicket"
  ADD CONSTRAINT "SsoTicket_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security coerente con le altre tabelle a tenantId diretto.
ALTER TABLE "SsoTicket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SsoTicket" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SsoTicket"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());
