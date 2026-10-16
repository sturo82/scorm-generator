-- Listino HeyGen per SECONDO di video, differenziato per ENGINE. HeyGen fattura
-- a crediti per minuto, con prezzi molto diversi per engine:
--   Avatar III ≈ 3 crediti/min, Avatar IV/V ≈ 20 crediti/min (1 credito ≈ $0.50).
--   → Avatar III ≈ $1.50/min; Avatar IV/V ≈ $10.00/min.
-- Il metering registra i SECONDI generati con model = "heygen-<engine>", quindi
-- il costo è quantità(sec) / perUnits(60) * unitPriceUsd(prezzo al minuto).
-- (Fonte prezzi: documentazione/pricing HeyGen 2026; rielaborato per conformità.
--  Aggiornare `unitPriceUsd` se il listino HeyGen cambia: una riga più recente
--  per `validFrom` sostituisce la precedente, lo storico resta immutato.)
--
-- Nota: la riga precedente (0028) model='heygen-avatar' unit='VIDEOS' resta nel
-- listino ma non è più usata (il metering ora emette SECONDS per-engine).
INSERT INTO "PricingRate" ("id","provider","model","unit","region","unitPriceUsd","perUnits","validFrom","note")
VALUES
  ('rate_heygen_iii_global', 'HEYGEN', 'heygen-avatar_iii', 'SECONDS', 'global', 1.50000000, 60, '2026-10-01T00:00:00Z', 'HeyGen Avatar III ~3 crediti/min (~$1.50/min)'),
  ('rate_heygen_iv_global',  'HEYGEN', 'heygen-avatar_iv',  'SECONDS', 'global', 10.00000000, 60, '2026-10-01T00:00:00Z', 'HeyGen Avatar IV ~20 crediti/min (~$10/min)'),
  ('rate_heygen_v_global',   'HEYGEN', 'heygen-avatar_v',   'SECONDS', 'global', 10.00000000, 60, '2026-10-01T00:00:00Z', 'HeyGen Avatar V ~20 crediti/min (~$10/min)');
