-- Listino HeyGen Voice (voci dei podcast, anche quelle proprie clonate): stima $30 / 1M caratteri
-- ($0.03 ogni 1.000), da verificare sul listino API HeyGen. Solo INSERT (il listino è versionato).
INSERT INTO "PricingRate" ("id","provider","model","unit","region","unitPriceUsd","perUnits","validFrom","note")
VALUES
  ('rate_heygen_voice_global', 'HEYGEN', 'heygen-voice-1', 'CHARACTERS', 'global', 30.00000000, 1000000, '2026-11-01T00:00:00Z', 'HeyGen Voice (podcast), stima da listino');
