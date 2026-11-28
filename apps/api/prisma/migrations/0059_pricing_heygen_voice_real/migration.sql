-- Voci HeyGen dei podcast: costo reale misurato sul wallet API (novembre 2026), circa $0,068 ogni
-- 494 caratteri con heygen_voice, orca, elevenlabs ed elevenlabs_v3, cioè ~$140 per milione.
-- Sostituisce la stima di 0057 ($30). Solo INSERT (il listino è versionato, mai UPDATE).
INSERT INTO "PricingRate" ("id","provider","model","unit","region","unitPriceUsd","perUnits","validFrom","note")
VALUES
  ('rate_heygen_voice_global_2611', 'HEYGEN', 'heygen-voice-1', 'CHARACTERS', 'global', 140.00000000, 1000000, '2026-11-28T00:00:00Z', 'HeyGen voce podcast (anche motore ElevenLabs v3), costo misurato sul wallet');
