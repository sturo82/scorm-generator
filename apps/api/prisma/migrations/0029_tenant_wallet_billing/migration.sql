-- Addebito in crediti (wallet di Manager) attivabile per singola azienda. Default false.
ALTER TABLE "Tenant" ADD COLUMN "walletBilling" BOOLEAN NOT NULL DEFAULT false;
