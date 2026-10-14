-- Introduce il provider BEDROCK_EMBEDDINGS per il metering degli embeddings.
--
-- IMPORTANTE: ALTER TYPE ... ADD VALUE deve stare in una migration a SÉ e il
-- nuovo valore NON può essere usato (es. in un INSERT) nella stessa
-- transazione in cui viene aggiunto (vincolo Postgres). Il listino prezzi che
-- USA questo valore è quindi nella migration successiva (0025). IF NOT EXISTS
-- rende l'ADD idempotente.
ALTER TYPE "MeterProvider" ADD VALUE IF NOT EXISTS 'BEDROCK_EMBEDDINGS';
