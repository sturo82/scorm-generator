-- Metering della generazione video avatar (HeyGen). HeyGen fattura per video
-- (crediti); il piano Free offre una quota mensile gratuita (3 video/mese).
-- Nuovo provider HEYGEN e nuova unità VIDEOS (1 record = 1 video generato).
--
-- IMPORTANTE: un valore enum appena aggiunto con ALTER TYPE ... ADD VALUE non
-- può essere usato (es. in un INSERT) nella stessa transazione. Il listino che
-- USA questi valori è quindi nella migration successiva (0028). IF NOT EXISTS
-- rende gli ADD idempotenti (Postgres 12+).

ALTER TYPE "MeterProvider" ADD VALUE IF NOT EXISTS 'HEYGEN';
ALTER TYPE "MeterUnit" ADD VALUE IF NOT EXISTS 'VIDEOS';
