-- Lezione "video-first": incentrata su un video (segnaposto) con quiz ed
-- elementi dinamici affiancati. Pilota il prompt di generazione e il layout
-- del player SCORM / anteprima.
ALTER TABLE "Lesson" ADD COLUMN "videoFirst" BOOLEAN NOT NULL DEFAULT false;
