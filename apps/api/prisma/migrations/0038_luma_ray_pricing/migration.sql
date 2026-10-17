-- Listino Luma Ray 2 (Bedrock, us-west-2) per SECONDO di video generato. Luma
-- genera clip di 5s o 9s; il prezzo a clip (720p, ~$0.45 per 5s) equivale a
-- ~$0.09/s. Registriamo il costo al secondo (perUnits=1) con
-- model = "luma.ray-v2:0", region us-west-2 e il ripiego 'global'.
-- (Fonte prezzi: pricing Luma/Bedrock 2026; rielaborato per conformità. Il
--  costo su Bedrock appare in Cost Explorer sotto il provider Luma AI. Aggiornare
--  con una riga più recente per validFrom se il listino cambia.)
INSERT INTO "PricingRate" ("id","provider","model","unit","region","unitPriceUsd","perUnits","validFrom","note")
VALUES
  ('rate_luma_ray_usw2',   'BEDROCK_VIDEO', 'luma.ray-v2:0', 'SECONDS', 'us-west-2', 0.09000000, 1, '2026-10-01T00:00:00Z', 'Luma Ray 2 ~$0.09/s (720p, ~$0.45 per clip 5s)'),
  ('rate_luma_ray_global', 'BEDROCK_VIDEO', 'luma.ray-v2:0', 'SECONDS', 'global',    0.09000000, 1, '2026-10-01T00:00:00Z', 'Luma Ray 2 ~$0.09/s (ripiego region-agnostico)');
