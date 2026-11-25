-- Listino Polly per il motore generativo (podcast): $30.00 / 1M caratteri (listino AWS, novembre 2026).
-- Il prezzo può variare per regione: controllare la pagina dei prezzi AWS quando si apre una nuova regione.
-- Solo INSERT (il listino è versionato, mai UPDATE).
INSERT INTO "PricingRate" ("id","provider","model","unit","region","unitPriceUsd","perUnits","validFrom","note")
VALUES
  ('rate_polly_generative_euc1', 'POLLY', 'polly-generative', 'CHARACTERS', 'eu-central-1', 30.00000000, 1000000, '2026-11-01T00:00:00Z', 'Polly Generative, listino AWS (podcast)'),
  ('rate_polly_generative_usw2', 'POLLY', 'polly-generative', 'CHARACTERS', 'us-west-2',    30.00000000, 1000000, '2026-11-01T00:00:00Z', 'Polly Generative, listino AWS');
