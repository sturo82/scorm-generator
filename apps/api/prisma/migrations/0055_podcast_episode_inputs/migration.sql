-- Podcast: le puntate si aggiungono una alla volta, ciascuna con le sue fonti e le sue indicazioni.
ALTER TABLE "PodcastEpisode"
  ADD COLUMN "notes"           TEXT  NOT NULL DEFAULT '',
  ADD COLUMN "knowledgeDocIds" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "articles"        JSONB NOT NULL DEFAULT '[]';
