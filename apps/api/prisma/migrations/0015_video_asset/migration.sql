-- Repository video per-tenant: video caricati (storage) e riferimenti a video
-- esterni (YouTube/Vimeo/Twitch), opzionalmente organizzati per canale. Un
-- VideoAsset è riutilizzabile tra lezioni (block video_checkpoint).

CREATE TYPE "VideoSource" AS ENUM ('UPLOAD', 'YOUTUBE', 'VIMEO', 'TWITCH');
CREATE TYPE "VideoTranscriptStatus" AS ENUM ('NONE', 'PROCESSING', 'READY', 'FAILED');

CREATE TABLE "VideoAsset" (
  "id"               TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL,
  "title"            TEXT NOT NULL,
  "description"      TEXT NOT NULL DEFAULT '',
  "source"           "VideoSource" NOT NULL DEFAULT 'UPLOAD',
  "storageKey"       TEXT,
  "mimeType"         TEXT,
  "sizeBytes"        INTEGER,
  "externalUrl"      TEXT,
  "externalId"       TEXT,
  "channel"          TEXT,
  "thumbnailKey"     TEXT,
  "durationSec"      INTEGER,
  "transcript"       JSONB NOT NULL DEFAULT '[]',
  "transcriptStatus" "VideoTranscriptStatus" NOT NULL DEFAULT 'NONE',
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VideoAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VideoAsset_tenantId_idx" ON "VideoAsset" ("tenantId");
CREATE INDEX "VideoAsset_tenantId_source_idx" ON "VideoAsset" ("tenantId", "source");
CREATE INDEX "VideoAsset_tenantId_channel_idx" ON "VideoAsset" ("tenantId", "channel");

ALTER TABLE "VideoAsset"
  ADD CONSTRAINT "VideoAsset_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: isolamento per tenant come le altre tabelle con tenantId diretto.
ALTER TABLE "VideoAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VideoAsset" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VideoAsset"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());
