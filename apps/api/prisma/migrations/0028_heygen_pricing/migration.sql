-- Listino prezzi HeyGen (generazione video avatar), unità VIDEOS (1 video).
-- Sul piano Free i video rientrano nella quota gratuita (3/mese), quindi il
-- costo marginale è 0: seminiamo unitPriceUsd=0 così il consumo resta TRACCIATO
-- (un UsageRecord per ogni video) e la quota mensile è calcolabile contando i
-- record, mentre il costo riportato resta corretto (0) finché si è sul Free.
-- Passando a un piano a pagamento basta inserire una riga più recente con il
-- prezzo reale per video: lo storico pregresso resta invariato (snapshot).
-- La region è una colonna del listino: usiamo 'global' perché HeyGen è un'API
-- SaaS non regionale (il metering passa region='global' per questo provider).
-- Separata dalla 0027 perché un valore enum appena aggiunto non è usabile nella
-- stessa transazione in cui viene creato.
INSERT INTO "PricingRate" ("id","provider","model","unit","region","unitPriceUsd","perUnits","validFrom","note")
VALUES
  ('rate_heygen_free_global', 'HEYGEN', 'heygen-avatar', 'VIDEOS', 'global', 0.00000000, 1, '2025-10-01T00:00:00Z', 'HeyGen piano Free: quota 3 video/mese, costo marginale 0');
