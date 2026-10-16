-- Correzione del listino HeyGen ai prezzi SELF-SERVE / Pay-As-You-Go reali
-- (quelli applicati agli utenti API senza contratto Enterprise), che il nostro
-- account usa. Le migrazioni precedenti (0029 generazione video, 0031 creazione
-- avatar) avevano usato per errore la base Enterprise "1 credito = $0.50", che
-- NON si applica al self-serve: lì il costo per credito è molto più basso
-- (~$0.0508/credito) e le operazioni hanno prezzi in USD già pubblicati.
--
-- Fonte: HeyGen API Pricing (Pay-As-You-Go), tabella "How many API credits does
-- each feature cost?" — rielaborata per conformità. Prezzi al minuto, fatturati
-- per secondo effettivo; la creazione avatar è un costo per chiamata.
--   Video Generation (Photo Avatar, i nostri avatar sono photo):
--     Avatar III Photo Avatar  = $0.99 / min (20 crediti/min)
--     Avatar IV  Photo Avatar  = $2.31 / min (46 crediti/min)
--     Avatar V   (solo Digital Twin) = $7.20 / min (144 crediti/min)
--   Avatar Creation:
--     Photo Avatar = $1.32 / chiamata (26 crediti)
--     Digital Twin = $2.13 / chiamata (43 crediti)
--
-- Si inseriscono righe con validFrom più recente: il resolver prezzi sceglie la
-- riga con validFrom <= now più recente, quindi queste SOSTITUISCONO le vecchie
-- senza alterare lo storico (le righe precedenti restano immutate).

INSERT INTO "PricingRate" ("id","provider","model","unit","region","unitPriceUsd","perUnits","validFrom","note")
VALUES
  -- Generazione video per secondo (prezzo al minuto / 60), per engine (photo avatar).
  ('rate_heygen_iii_v2', 'HEYGEN', 'heygen-avatar_iii', 'SECONDS', 'global', 0.99000000, 60, '2026-10-02T00:00:00Z', 'HeyGen self-serve Avatar III Photo Avatar $0.99/min (20 cr/min)'),
  ('rate_heygen_iv_v2',  'HEYGEN', 'heygen-avatar_iv',  'SECONDS', 'global', 2.31000000, 60, '2026-10-02T00:00:00Z', 'HeyGen self-serve Avatar IV Photo Avatar $2.31/min (46 cr/min)'),
  ('rate_heygen_v_v2',   'HEYGEN', 'heygen-avatar_v',   'SECONDS', 'global', 7.20000000, 60, '2026-10-02T00:00:00Z', 'HeyGen self-serve Avatar V Digital Twin $7.20/min (144 cr/min)'),
  -- Creazione avatar per chiamata (photo avatar: il tipo che creiamo da piattaforma).
  ('rate_heygen_avatar_creation_v2', 'HEYGEN', 'heygen-avatar-creation', 'CALLS', 'global', 1.32000000, 1, '2026-10-02T00:00:00Z', 'HeyGen self-serve Avatar Creation Photo Avatar $1.32/call (26 cr)')
ON CONFLICT ("id") DO NOTHING;
