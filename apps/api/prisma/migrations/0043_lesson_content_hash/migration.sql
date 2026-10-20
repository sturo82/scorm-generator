-- Impronta degli input con cui i contenuti della lezione sono stati generati
-- (formato, obiettivi, taglio, tono, fonti, versione prompt). Confrontandola con
-- l'impronta corrente si rileva quando una lezione è "da rigenerare".
-- Nullable: lezioni storiche / mai generate restano in stato "ignoto".
ALTER TABLE "Lesson" ADD COLUMN "contentInputHash" TEXT;
