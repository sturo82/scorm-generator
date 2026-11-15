-- Listino del montaggio "slide + avatar" (Remotion su Lambda): solo CPU di
-- rendering, nessuna voce sintetizzata da noi (la voce è nelle clip HeyGen, già
-- misurate a parte con source 'slide_clip'). Tariffa interna prudente ~$0.002/s
-- (~$0.12 al minuto di video finale). Region-agnostica ('global').
INSERT INTO "PricingRate" ("id","provider","model","unit","region","unitPriceUsd","perUnits","validFrom","note")
VALUES
  ('rate_remotion_slide_video_global', 'BEDROCK_VIDEO', 'remotion-slide-video', 'SECONDS', 'global', 0.00200000, 1, '2026-10-15T00:00:00Z', 'Montaggio slide+avatar Remotion Lambda: tariffa interna ~$0.002/s (solo CPU render)')
ON CONFLICT ("id") DO NOTHING;
