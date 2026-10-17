-- Metering della generazione cartoon delle scene "pillole" (Amazon Nova Reel,
-- Bedrock). Nova Reel fattura per SECONDO di video generato (~$0.08/s). Nuovo
-- provider BEDROCK_VIDEO; l'unità SECONDS esiste già.
--
-- IMPORTANTE: un valore enum appena aggiunto con ALTER TYPE ... ADD VALUE non
-- può essere usato nella stessa transazione. Il listino che USA questo valore
-- è quindi nella migration successiva (0037). IF NOT EXISTS rende idempotente.

ALTER TYPE "MeterProvider" ADD VALUE IF NOT EXISTS 'BEDROCK_VIDEO';
