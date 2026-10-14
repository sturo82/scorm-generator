-- Listino prezzi per il modello LLM EFFETTIVAMENTE in uso in produzione.
--
-- Contesto: il seed originale (0009) registrò il modello/region US
-- (us.anthropic.claude-sonnet-4-5-...-v1:0 su us-west-2), ma la produzione usa
-- il cross-region inference profile EU `eu.anthropic.claude-sonnet-4-6` e il
-- metering fa lookup su region `eu-west-1` (= BEDROCK_REGION). Mancando la riga
-- di listino per (modello EU, eu-west-1), ogni consumo veniva registrato a
-- costo 0 e i corsi risultavano "costati 0".
--
-- Prezzi: il modello su region EU di Bedrock ha un sovrapprezzo rispetto alla
-- versione US. Listino AWS Bedrock (EU): input $3.30 / 1M, output $16.50 / 1M.
-- VERSIONATI: un futuro aggiornamento prezzi = nuova migrazione (validFrom
-- successivo), non una modifica di queste righe.
--
-- NB: i costi dei consumi GIA' registrati a 0 non vengono ricalcolati
-- retroattivamente (lo storico resta immutabile); il calcolo corretto vale per
-- i consumi successivi.
INSERT INTO "PricingRate" ("id","provider","model","unit","region","unitPriceUsd","perUnits","validFrom","note")
VALUES
  ('rate_claude46_eu_in',  'BEDROCK_LLM', 'eu.anthropic.claude-sonnet-4-6', 'INPUT_TOKENS',  'eu-west-1',  3.30000000, 1000000, '2025-10-01T00:00:00Z', 'Claude Sonnet 4.6 EU input, listino AWS Bedrock (region EU)'),
  ('rate_claude46_eu_out', 'BEDROCK_LLM', 'eu.anthropic.claude-sonnet-4-6', 'OUTPUT_TOKENS', 'eu-west-1', 16.50000000, 1000000, '2025-10-01T00:00:00Z', 'Claude Sonnet 4.6 EU output, listino AWS Bedrock (region EU)');
