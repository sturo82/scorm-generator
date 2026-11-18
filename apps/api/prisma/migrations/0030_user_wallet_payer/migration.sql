-- Wallet che paga le generazioni dell'utente: 'COMPANY' (default) o 'PERSONAL'. L'id del wallet
-- personale (company_id "p-…" assegnato da Manager) si salva alla prima attivazione.
ALTER TABLE "User" ADD COLUMN "walletPayer" TEXT NOT NULL DEFAULT 'COMPANY';
ALTER TABLE "User" ADD COLUMN "personalWalletId" TEXT;
