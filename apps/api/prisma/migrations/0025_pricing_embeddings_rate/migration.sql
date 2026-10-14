-- Listino prezzi per gli embeddings (Amazon Titan Text Embeddings V2).
--
-- Separata da 0024 (che aggiunge il valore enum BEDROCK_EMBEDDINGS): Postgres
-- non consente di usare un valore enum nella stessa transazione in cui è stato
-- aggiunto con ALTER TYPE ... ADD VALUE. Qui il valore esiste già (migration
-- precedente committata), quindi l'INSERT può usarlo.
--
-- Titan Text Embeddings V2 fattura per token di INPUT (produce solo vettori,
-- nessun costo di output). Prezzo AWS Bedrock: $0.02 / 1M token, uniforme per
-- regione. VERSIONATO: aggiornamenti futuri = nuova migrazione.
INSERT INTO "PricingRate" ("id","provider","model","unit","region","unitPriceUsd","perUnits","validFrom","note")
VALUES
  ('rate_titanembed_eu_in', 'BEDROCK_EMBEDDINGS', 'amazon.titan-embed-text-v2:0', 'INPUT_TOKENS', 'eu-west-1', 0.02000000, 1000000, '2025-10-01T00:00:00Z', 'Titan Text Embeddings V2 input, listino AWS Bedrock')
ON CONFLICT ("id") DO NOTHING;
