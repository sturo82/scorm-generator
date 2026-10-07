-- Docente/relatore del corso (Blocco: header sempre visibile): nome, ruolo e
-- foto, mostrati nell'header premium di anteprima e player SCORM. Tutti opzionali.
ALTER TABLE "Course" ADD COLUMN "instructorName" TEXT;
ALTER TABLE "Course" ADD COLUMN "instructorRole" TEXT;
ALTER TABLE "Course" ADD COLUMN "instructorAvatarKey" TEXT;
