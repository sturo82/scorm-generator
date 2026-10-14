-- Metering degli embeddings (Amazon Titan Text Embeddings V2 su Bedrock).
--
-- Finora l'ingestion della knowledge base e le query RAG in generazione NON
-- erano misurate: il loro costo embeddings non compariva da nessuna parte.
-- Introduciamo il provider BEDROCK_EMBEDDINGS e il relativo listino.
--
-- ALTER TYPE ... ADD VALUE non è usabile nella stessa transazione del suo uso:
-- va in una migration a sé (questa). IF NOT EXISTS la rende idempotente.
ALTER TYPE "MeterProvider" ADD VALUE IF NOT EXISTS 'BEDROCK_EMBEDDINGS';

-- Listino: Titan Text Embeddings V2 fattura per token di INPUT (nessun costo di
-- output: produce solo vettori). Prezzo AWS Bedrock: $0.02 / 1M token, uniforme
-- per regione (nessun sovrapprezzo EU come per i modelli Anthropic).
-- VERSIONATO: un futuro aggiornamento = nuova migrazione (validFrom successivo).
INSERT INTO "PricingRate" ("id","provider","model","unit","region","unitPriceUsd","perUnits","validFrom","note")
VALUES
  ('rate_titanembed_eu_in', 'BEDROCK_EMBEDDINGS', 'amazon.titan-embed-text-v2:0', 'INPUT_TOKENS', 'eu-west-1', 0.02000000, 1000000, '2025-10-01T00:00:00Z', 'Titan Text Embeddings V2 input, listino AWS Bedrock')
ON CONFLICT ("id") DO NOTHING;
