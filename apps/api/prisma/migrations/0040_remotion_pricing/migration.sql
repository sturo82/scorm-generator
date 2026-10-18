-- Listino del code-to-video (Remotion): i cartoon delle pillole generati per
-- programma non usano un modello neurale. Il costo reale è TTS (Polly, già
-- metrato a parte sulla narrazione quando applicabile) + CPU di rendering:
-- pochi centesimi a scena. Registriamo una tariffa interna prudente al secondo
-- (perUnits=1) per model = "remotion-code-to-video", region-agnostica ('global').
-- ~$0.01/s è ~16-150x più economico dei modelli neurali (Luma ~$0.09-1.5/s).
INSERT INTO "PricingRate" ("id","provider","model","unit","region","unitPriceUsd","perUnits","validFrom","note")
VALUES
  ('rate_remotion_c2v_global', 'BEDROCK_VIDEO', 'remotion-code-to-video', 'SECONDS', 'global', 0.01000000, 1, '2026-10-01T00:00:00Z', 'Code-to-video Remotion: tariffa interna ~$0.01/s (TTS + CPU render)');
