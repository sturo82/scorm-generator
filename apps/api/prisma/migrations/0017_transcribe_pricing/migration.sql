-- Listino prezzi di Amazon Transcribe (batch standard). Fattura per secondo di
-- audio: $0.02400 / minuto → unitPriceUsd=0.024 per perUnits=60 secondi.
-- Fonte: listino ufficiale AWS (ottobre 2025). Separata dalla 0016 perché un
-- valore enum appena aggiunto non è usabile nella stessa transazione.
-- Seminato per le regioni comuni; aggiungere righe per altre regioni se serve.
INSERT INTO "PricingRate" ("id","provider","model","unit","region","unitPriceUsd","perUnits","validFrom","note")
VALUES
  ('rate_transcribe_use1', 'TRANSCRIBE', 'transcribe-batch', 'SECONDS', 'us-east-1', 0.02400000, 60, '2025-10-01T00:00:00Z', 'Amazon Transcribe batch, listino AWS'),
  ('rate_transcribe_usw2', 'TRANSCRIBE', 'transcribe-batch', 'SECONDS', 'us-west-2', 0.02400000, 60, '2025-10-01T00:00:00Z', 'Amazon Transcribe batch, listino AWS');
