-- Stile delle micro-interazioni del corso (Blocco F — UX premium): governa
-- l'intensità delle animazioni di flashcard, quiz, accordion/tabs e hotspot.
-- Valori ammessi (validati a livello applicativo dall'enum del contratto Course):
--   "sober"  = transizioni morbide e sobrie (default enterprise)
--   "lively" = animazioni più espressive (bounce/pulse/celebrazione quiz)
-- Lo stesso valore pilota sia l'anteprima web sia il player SCORM esportato
-- tramite l'attributo data-motion sul contenitore.
ALTER TABLE "Course" ADD COLUMN "interactionStyle" TEXT NOT NULL DEFAULT 'sober';
