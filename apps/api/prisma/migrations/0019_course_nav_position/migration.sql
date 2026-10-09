-- Posizione del menu/indice di navigazione del corso: "side" (sidebar, default)
-- o "top" (barra in alto espandibile). Applicata identica in anteprima e player.
ALTER TABLE "Course" ADD COLUMN "navPosition" TEXT NOT NULL DEFAULT 'side';
