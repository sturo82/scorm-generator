-- Podcast: serie di puntate audio a due voci (contenuto autonomo, fuori dai corsi).
CREATE TYPE "PodcastFeedVisibility" AS ENUM ('PUBLIC', 'PRIVATE');
CREATE TYPE "PodcastEpisodeState" AS ENUM ('DRAFT', 'WRITING', 'SCRIPT_READY', 'VOICING', 'READY', 'FAILED');

CREATE TABLE "Podcast" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "description"     TEXT NOT NULL DEFAULT '',
  "language"        TEXT NOT NULL DEFAULT 'it',
  "category"        TEXT NOT NULL DEFAULT 'Education',
  "author"          TEXT,
  "contactEmail"    TEXT,
  "explicit"        BOOLEAN NOT NULL DEFAULT false,
  "coverKey"        TEXT,
  "hosts"           JSONB NOT NULL,
  "brief"           JSONB NOT NULL,
  "knowledgeDocIds" JSONB NOT NULL DEFAULT '[]',
  "articles"        JSONB NOT NULL DEFAULT '[]',
  "visibility"      "PodcastFeedVisibility" NOT NULL DEFAULT 'PRIVATE',
  "publicId"        TEXT NOT NULL,
  "feedToken"       TEXT NOT NULL,
  "createdBy"       TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Podcast_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Podcast_publicId_key" ON "Podcast" ("publicId");
CREATE INDEX "Podcast_tenantId_idx" ON "Podcast" ("tenantId");
ALTER TABLE "Podcast"
  ADD CONSTRAINT "Podcast_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PodcastEpisode" (
  "id"             TEXT NOT NULL,
  "podcastId"      TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "position"       INTEGER NOT NULL,
  "title"          TEXT NOT NULL,
  "summary"        TEXT NOT NULL DEFAULT '',
  "targetMinutes"  INTEGER NOT NULL DEFAULT 10,
  "sources"        JSONB NOT NULL DEFAULT '[]',
  "script"         JSONB,
  "state"          "PodcastEpisodeState" NOT NULL DEFAULT 'DRAFT',
  "error"          TEXT,
  "leaseUntil"     TIMESTAMP(3),
  "billing"        JSONB,
  "audioKey"       TEXT,
  "audioStale"     BOOLEAN NOT NULL DEFAULT false,
  "durationSec"    INTEGER,
  "sizeBytes"      INTEGER,
  "turnTimings"    JSONB,
  "guid"           TEXT NOT NULL,
  "publishedAt"    TIMESTAMP(3),
  "publicAudioKey" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PodcastEpisode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PodcastEpisode_guid_key" ON "PodcastEpisode" ("guid");
CREATE INDEX "PodcastEpisode_podcastId_position_idx" ON "PodcastEpisode" ("podcastId", "position");
CREATE INDEX "PodcastEpisode_tenantId_idx" ON "PodcastEpisode" ("tenantId");
ALTER TABLE "PodcastEpisode"
  ADD CONSTRAINT "PodcastEpisode_podcastId_fkey"
  FOREIGN KEY ("podcastId") REFERENCES "Podcast" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: isolamento per tenant come le altre tabelle con tenantId diretto.
ALTER TABLE "Podcast" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Podcast" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Podcast"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());
ALTER TABLE "PodcastEpisode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PodcastEpisode" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PodcastEpisode"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());
