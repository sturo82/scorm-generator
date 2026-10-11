-- Ecosistema Knowkube: identità dell'installazione (onboarding zero-touch).
-- Riga singola a livello di processo (NON tenant-scoped): persiste il
-- provisioning kit ricevuto da Manager. Il secret M2M vive in Secrets Manager
-- (qui solo l'ARN di riferimento). Nessuna RLS: non contiene dati di tenant.

CREATE TABLE "EcosystemInstallation" (
    "id" TEXT NOT NULL DEFAULT 'self',
    "installationId" TEXT NOT NULL,
    "productKey" TEXT NOT NULL,
    "oidcIssuer" TEXT,
    "oidcClientId" TEXT,
    "oidcAuthDomain" TEXT,
    "oidcScope" TEXT,
    "m2mClientId" TEXT,
    "m2mSecretArn" TEXT,
    "enforce" TEXT,
    "walletEnabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastKitAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EcosystemInstallation_pkey" PRIMARY KEY ("id")
);
