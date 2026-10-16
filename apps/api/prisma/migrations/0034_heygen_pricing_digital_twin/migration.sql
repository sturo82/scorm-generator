-- Completa il listino HeyGen con il TERZO tipo di avatar, 'digital_twin', che ha
-- tariffe proprie distinte da 'photo' e 'studio', e corregge Avatar V (che è
-- disponibile SOLO per i digital twin). Prezzi self-serve per minuto:
--   Avatar III  — Digital Twin $0.60 (12 cr/min)
--   Avatar IV   — Digital Twin $4.83 (97 cr/min)
--   Avatar V    — Digital Twin $7.20 (144 cr/min)
-- Le righe photo/studio restano quelle di 0033. Le righe V photo/studio di 0033
-- restano a listino come valore prudenziale (quelle combinazioni non vengono
-- più offerte in UI), ma aggiungiamo qui la riga V corretta (digital_twin).
-- validFrom coerente con le altre correzioni self-serve (il resolver sceglie la
-- riga più recente per validFrom <= now).
INSERT INTO "PricingRate" ("id","provider","model","unit","region","unitPriceUsd","perUnits","validFrom","note")
VALUES
  ('rate_heygen_iii_dtwin', 'HEYGEN', 'heygen-avatar_iii-digital_twin', 'SECONDS', 'global', 0.60000000, 60, '2026-10-02T00:00:00Z', 'HeyGen self-serve Avatar III Digital Twin $0.60/min (12 cr/min)'),
  ('rate_heygen_iv_dtwin',  'HEYGEN', 'heygen-avatar_iv-digital_twin',  'SECONDS', 'global', 4.83000000, 60, '2026-10-02T00:00:00Z', 'HeyGen self-serve Avatar IV Digital Twin $4.83/min (97 cr/min)'),
  ('rate_heygen_v_dtwin',   'HEYGEN', 'heygen-avatar_v-digital_twin',   'SECONDS', 'global', 7.20000000, 60, '2026-10-02T00:00:00Z', 'HeyGen self-serve Avatar V Digital Twin $7.20/min (144 cr/min)'),
  -- Creazione digital twin via API ($2.13/call, 43 cr). La riga photo ($1.32) è
  -- già a listino (0032); qui aggiungiamo il digital twin per completezza.
  ('rate_heygen_avatar_creation_dtwin', 'HEYGEN', 'heygen-avatar-creation-digital_twin', 'CALLS', 'global', 2.13000000, 1, '2026-10-02T00:00:00Z', 'HeyGen self-serve Digital Twin creation $2.13/call (43 cr)')
ON CONFLICT ("id") DO NOTHING;
