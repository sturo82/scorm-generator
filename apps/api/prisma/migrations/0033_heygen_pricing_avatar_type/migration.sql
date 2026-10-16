-- Listino HeyGen per generazione video differenziato per ENGINE **e** per TIPO
-- di avatar. A parità di engine, un avatar "photo" (custom, creato da noi) ha
-- una tariffa diversa (più bassa) rispetto a uno "studio" (avatar STOCK del
-- catalogo HeyGen). La differenza è marcata su Avatar IV.
--
-- Prezzi self-serve / Pay-As-You-Go (per minuto, fatturati per secondo),
-- rielaborati per conformità dalla tabella pubblica HeyGen:
--   Avatar III  — Photo $0.99/min  | Studio $0.99/min
--   Avatar IV   — Photo $2.31/min  | Studio $4.83/min
--   Avatar V    — (solo Digital Twin $7.20/min; applichiamo $7.20 a entrambi
--                  i tipi per prudenza, V non supporta i photo avatar)
--
-- Il metering ora emette model = "heygen-<engine>-<tipo>" (tipo: photo|studio),
-- quindi queste righe sostituiscono di fatto le precedenti "heygen-<engine>"
-- (che restano a listino ma non vengono più referenziate). validFrom coerente
-- con le altre correzioni self-serve.
INSERT INTO "PricingRate" ("id","provider","model","unit","region","unitPriceUsd","perUnits","validFrom","note")
VALUES
  ('rate_heygen_iii_photo',  'HEYGEN', 'heygen-avatar_iii-photo',  'SECONDS', 'global', 0.99000000, 60, '2026-10-02T00:00:00Z', 'HeyGen self-serve Avatar III Photo Avatar $0.99/min'),
  ('rate_heygen_iii_studio', 'HEYGEN', 'heygen-avatar_iii-studio', 'SECONDS', 'global', 0.99000000, 60, '2026-10-02T00:00:00Z', 'HeyGen self-serve Avatar III Studio Avatar $0.99/min'),
  ('rate_heygen_iv_photo',   'HEYGEN', 'heygen-avatar_iv-photo',   'SECONDS', 'global', 2.31000000, 60, '2026-10-02T00:00:00Z', 'HeyGen self-serve Avatar IV Photo Avatar $2.31/min'),
  ('rate_heygen_iv_studio',  'HEYGEN', 'heygen-avatar_iv-studio',  'SECONDS', 'global', 4.83000000, 60, '2026-10-02T00:00:00Z', 'HeyGen self-serve Avatar IV Studio Avatar $4.83/min'),
  ('rate_heygen_v_photo',    'HEYGEN', 'heygen-avatar_v-photo',    'SECONDS', 'global', 7.20000000, 60, '2026-10-02T00:00:00Z', 'HeyGen self-serve Avatar V $7.20/min (Digital Twin; prudenziale)'),
  ('rate_heygen_v_studio',   'HEYGEN', 'heygen-avatar_v-studio',   'SECONDS', 'global', 7.20000000, 60, '2026-10-02T00:00:00Z', 'HeyGen self-serve Avatar V $7.20/min (Digital Twin; prudenziale)')
ON CONFLICT ("id") DO NOTHING;
