-- Listino Claude Opus 5.5 su Bedrock (copioni e controllo di realismo dei podcast):
-- $4 / $20 per milione di token (input / output); +10% sull'endpoint regionale UE.
-- Solo INSERT (il listino è versionato, mai UPDATE).
INSERT INTO "PricingRate" ("id","provider","model","unit","region","unitPriceUsd","perUnits","validFrom","note")
VALUES
  ('rate_opus55_eu_in',  'BEDROCK_LLM', 'eu.anthropic.claude-opus-5-5', 'INPUT_TOKENS',  'eu-west-1',  4.40000000, 1000000, '2026-11-01T00:00:00Z', 'Claude Opus 5.5 EU input, listino AWS Bedrock'),
  ('rate_opus55_eu_out', 'BEDROCK_LLM', 'eu.anthropic.claude-opus-5-5', 'OUTPUT_TOKENS', 'eu-west-1', 22.00000000, 1000000, '2026-11-01T00:00:00Z', 'Claude Opus 5.5 EU output, listino AWS Bedrock'),
  ('rate_opus55_us_in',  'BEDROCK_LLM', 'us.anthropic.claude-opus-5-5', 'INPUT_TOKENS',  'us-west-2',  4.00000000, 1000000, '2026-11-01T00:00:00Z', 'Claude Opus 5.5 US input, listino AWS Bedrock'),
  ('rate_opus55_us_out', 'BEDROCK_LLM', 'us.anthropic.claude-opus-5-5', 'OUTPUT_TOKENS', 'us-west-2', 20.00000000, 1000000, '2026-11-01T00:00:00Z', 'Claude Opus 5.5 US output, listino AWS Bedrock');
