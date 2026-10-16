-- Listino per la creazione avatar HeyGen. Separato da 0030 perché Postgres non
-- consente di usare un nuovo valore enum ('CALLS') nella stessa transazione in
-- cui è stato aggiunto (ADD VALUE): la migrazione 0030 aggiunge il valore, qui
-- lo usiamo nel listino.
--   Avatar Creation = 1 credito/chiamata, 1 credito = $0.50 → $0.50 a creazione.
INSERT INTO "PricingRate" ("id","provider","model","unit","region","unitPriceUsd","perUnits","validFrom","note")
VALUES
  ('rate_heygen_avatar_creation_global', 'HEYGEN', 'heygen-avatar-creation', 'CALLS', 'global', 0.50000000, 1, '2026-10-01T00:00:00Z', 'HeyGen Avatar Creation 1 credito/chiamata (~$0.50)')
ON CONFLICT ("id") DO NOTHING;
