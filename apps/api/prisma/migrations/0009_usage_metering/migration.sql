-- Metering costi AI e listino prezzi versionato (cost-plus con markup).
-- Introduce:
--   - MeterProvider / MeterUnit (enum)
--   - PricingRate: listino versionato per (provider, model, unit, region)
--   - UsageRecord: un addebito atomico per ogni chiamata a pagamento
-- UsageRecord ha tenantId diretto => protetto da RLS come le altre tabelle
-- tenant-scoped (difesa in profondità). PricingRate è un listino globale
-- (non per-tenant): nessuna RLS, sola lettura applicativa.

-- Enum ----------------------------------------------------------------------
CREATE TYPE "MeterProvider" AS ENUM ('BEDROCK_LLM', 'BEDROCK_IMAGE', 'POLLY');
CREATE TYPE "MeterUnit" AS ENUM ('INPUT_TOKENS', 'OUTPUT_TOKENS', 'IMAGES', 'CHARACTERS');

-- PricingRate ---------------------------------------------------------------
CREATE TABLE "PricingRate" (
  "id"           TEXT NOT NULL,
  "provider"     "MeterProvider" NOT NULL,
  "model"        TEXT NOT NULL,
  "unit"         "MeterUnit" NOT NULL,
  "region"       TEXT NOT NULL,
  "unitPriceUsd" DECIMAL(16,8) NOT NULL,
  "perUnits"     INTEGER NOT NULL DEFAULT 1,
  "validFrom"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note"         TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PricingRate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PricingRate_provider_model_unit_region_validFrom_idx"
  ON "PricingRate" ("provider", "model", "unit", "region", "validFrom");

-- UsageRecord ---------------------------------------------------------------
CREATE TABLE "UsageRecord" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "courseId"     TEXT,
  "jobId"        TEXT,
  "provider"     "MeterProvider" NOT NULL,
  "model"        TEXT NOT NULL,
  "unit"         "MeterUnit" NOT NULL,
  "quantity"     INTEGER NOT NULL,
  "unitPriceUsd" DECIMAL(16,8) NOT NULL,
  "perUnits"     INTEGER NOT NULL DEFAULT 1,
  "costUsd"      DECIMAL(16,8) NOT NULL,
  "source"       TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UsageRecord_tenantId_idx" ON "UsageRecord" ("tenantId");
CREATE INDEX "UsageRecord_courseId_idx" ON "UsageRecord" ("courseId");
CREATE INDEX "UsageRecord_jobId_idx" ON "UsageRecord" ("jobId");
CREATE INDEX "UsageRecord_tenantId_createdAt_idx" ON "UsageRecord" ("tenantId", "createdAt");

ALTER TABLE "UsageRecord"
  ADD CONSTRAINT "UsageRecord_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageRecord"
  ADD CONSTRAINT "UsageRecord_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS: UsageRecord ha tenantId diretto, stessa policy delle altre tabelle.
ALTER TABLE "UsageRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "UsageRecord"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());

-- Seed del listino prezzi (on-demand, regione us-west-2 / inference profile US).
-- Fonte: listino ufficiale AWS (ottobre 2025). I prezzi sono VERSIONATI: un
-- futuro aggiornamento = nuova migrazione con nuove righe (validFrom successivo),
-- mai UPDATE. Prezzi in USD.
--   Claude Sonnet 4.5 (US): $3.00 / 1M input token, $15.00 / 1M output token
--   Stable Image Core:      $0.04 / immagine
--   Polly Neural:           $16.00 / 1M caratteri
INSERT INTO "PricingRate" ("id","provider","model","unit","region","unitPriceUsd","perUnits","validFrom","note")
VALUES
  ('rate_claude45_in',  'BEDROCK_LLM',   'us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'INPUT_TOKENS',  'us-west-2', 3.00000000, 1000000, '2025-10-01T00:00:00Z', 'Claude Sonnet 4.5 US input, listino AWS'),
  ('rate_claude45_out', 'BEDROCK_LLM',   'us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'OUTPUT_TOKENS', 'us-west-2', 15.00000000, 1000000, '2025-10-01T00:00:00Z', 'Claude Sonnet 4.5 US output, listino AWS'),
  ('rate_stable_core',  'BEDROCK_IMAGE', 'stability.stable-image-core-v1:1',             'IMAGES',        'us-west-2', 0.04000000, 1, '2025-10-01T00:00:00Z', 'Stable Image Core, listino AWS Bedrock'),
  ('rate_polly_neural', 'POLLY',         'polly-neural',                                 'CHARACTERS',    'us-west-2', 16.00000000, 1000000, '2025-10-01T00:00:00Z', 'Polly Neural, listino AWS');
