-- Metering di Amazon Transcribe (trascrizione video ASR). Transcribe fattura
-- per secondo di audio trascritto: nuovo provider TRANSCRIBE e nuova unità
-- SECONDS. ADD VALUE è idempotente con IF NOT EXISTS (Postgres 12+).

ALTER TYPE "MeterProvider" ADD VALUE IF NOT EXISTS 'TRANSCRIBE';
ALTER TYPE "MeterUnit" ADD VALUE IF NOT EXISTS 'SECONDS';
