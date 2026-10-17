-- Listino Amazon Nova Reel per SECONDO di video generato. Prezzo ~$0.08/s
-- (unitPriceUsd diretto al secondo, perUnits=1). Il metering registra i SECONDI
-- del cartoon con model = "amazon.nova-reel-v1:0".
-- (Fonte prezzi: pricing Amazon Nova / Bedrock 2026; rielaborato per conformità.
--  Aggiornare con una riga più recente per `validFrom` se il listino cambia.)
--
-- region: Nova Reel è disponibile in alcune region Bedrock (default us-east-1).
-- Registriamo il listino sia per us-east-1 sia per la pseudo-region 'global'
-- come ripiego, così il lookup non manca se l'evento usa una region diversa.
INSERT INTO "PricingRate" ("id","provider","model","unit","region","unitPriceUsd","perUnits","validFrom","note")
VALUES
  ('rate_nova_reel_use1', 'BEDROCK_VIDEO', 'amazon.nova-reel-v1:0', 'SECONDS', 'us-east-1', 0.08000000, 1, '2026-10-01T00:00:00Z', 'Amazon Nova Reel ~$0.08/s (text-to-video, 720p)'),
  ('rate_nova_reel_global', 'BEDROCK_VIDEO', 'amazon.nova-reel-v1:0', 'SECONDS', 'global', 0.08000000, 1, '2026-10-01T00:00:00Z', 'Amazon Nova Reel ~$0.08/s (ripiego region-agnostico)');
