-- Branding white-label della web app, per-tenant: nome app, colore primario,
-- chiavi storage di logo e favicon. JSONB validato dall'AppBranding schema.
ALTER TABLE "Tenant" ADD COLUMN "branding" JSONB NOT NULL DEFAULT '{}';
