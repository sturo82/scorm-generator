/*
 * course-labels.ts — Dizionario delle ETICHETTE STRUTTURALI del corso (chrome
 * del player/anteprima): "Panoramica del corso", "Modulo N", nav Avanti/
 * Precedente, stato dei concetti, intro/esito dei test, completamento.
 *
 * Queste etichette NON sono contenuto generato: sono l'interfaccia del corso e
 * DEVONO seguire la LINGUA DEL CORSO (course.language), non la lingua dell'app.
 * È la fonte di verità UNICA condivisa tra l'anteprima web (React) e il player
 * del pacchetto SCORM (vanilla): entrambi importano/riusano questo set, così le
 * due esperienze restano identiche e coerenti con la lingua del corso.
 *
 * Lingue supportate: italiano e inglese. Per qualsiasi altro codice si usa
 * l'inglese come fallback (lingua franca), evitando di mostrare italiano a un
 * corso in un'altra lingua.
 */

export interface CourseLabels {
  courseOverview: string;
  programme: string;
  objectives: string;
  moduleLessons: string;
  /** "Modulo N" / "Module N". */
  moduleN: (n: number) => string;
  /** Etichetta conteggio moduli (singolare/plurale, con numero). */
  moduleCount: (n: number) => string;
  /** Etichetta conteggio lezioni (singolare/plurale, con numero). */
  lessonCount: (n: number) => string;
  /** Solo la parola Modulo/Moduli secondo il numero (per i badge statistici). */
  moduleWord: (n: number) => string;
  /** Solo la parola Lezione/Lezioni secondo il numero (per i badge statistici). */
  lessonWord: (n: number) => string;

  next: string;
  prev: string;
  completeCourse: string;
  /** "X di Y" / "X of Y". */
  stepStatus: (current: number, total: number) => string;

  conceptPrev: string;
  conceptNext: string;
  conceptCompleted: string;
  /** "Concetto X di Y" / "Concept X of Y". */
  conceptStatus: (current: number, total: number) => string;
  /** "Concetto N" / "Concept N" (fallback titolo). */
  conceptN: (n: number) => string;

  finalAssessment: string;
  intermediateTest: string;
  testGeneric: string;
  /** Intro test con gate: soglia % per sbloccare il modulo successivo. */
  assessmentGateIntro: (pct: number) => string;
  assessmentFinalIntro: string;
  assessmentNoQuestions: string;
  /** "Soglia di superamento: N%". */
  masteryThreshold: (pct: number) => string;
  /** "Punteggio: N%." */
  scoreLabel: (pct: number) => string;
  quizPass: string;
  quizFail: string;

  listenLesson: string;
  audioFallback: string;
  lessonEmpty: string;

  courseCompletedTitle: string;
  courseCompletedBody: string;
  courseEndedTitle: string;
  courseEndedFail: string;

  hintPassTest: string;
  hintScrollToEnd: string;

  viewSlide: string;
  viewScroll: string;
  viewHybrid: string;

  loading: string;

  // --- Etichette interne ai block (renderer condiviso) ---
  flashcardFront: string;
  flashcardBack: string;
  flashcardFlip: string;
  carouselPrev: string;
  carouselNext: string;
  /** "Passo X di Y" / "Step X of Y" (stato del carosello). */
  carouselStatus: (current: number, total: number) => string;
  dndDropHere: string;
  dndAllCorrect: string;
  /** "X su Y corretti. ..." / "X of Y correct. ...". */
  dndPartial: (correct: number, total: number) => string;
  moveUp: string;
  moveDown: string;
  scenarioNoStart: string;
  /** "Fine scenario. Punteggio: N" / "Scenario complete. Score: N". */
  scenarioEnd: (score: number) => string;
  scenarioRestart: string;
  transcript: string;
  transcriptProcessing: string;
  transcriptNone: string;
  videoComing: string;
  videoAlt: string;
  /** Credito foto: "Foto di {autore} su {provider}". */
  photoCreditBy: string;
  photoCreditOn: string;
  imagePlaceholderBadge: string;
  imagePlaceholderHint: string;
  imagePlaceholderAltLabel: string;
}

const EN: CourseLabels = {
  courseOverview: 'Course overview',
  programme: 'Course programme',
  objectives: 'Objectives',
  moduleLessons: 'Lessons in this module',
  moduleN: (n) => `Module ${n}`,
  moduleCount: (n) => `${n} ${n === 1 ? 'module' : 'modules'}`,
  lessonCount: (n) => `${n} ${n === 1 ? 'lesson' : 'lessons'}`,
  moduleWord: (n) => (n === 1 ? 'Module' : 'Modules'),
  lessonWord: (n) => (n === 1 ? 'Lesson' : 'Lessons'),

  next: 'Next',
  prev: 'Previous',
  completeCourse: 'Finish course',
  stepStatus: (c, t) => `${c} of ${t}`,

  conceptPrev: '‹ Previous concept',
  conceptNext: 'Next concept ›',
  conceptCompleted: 'Concept completed',
  conceptStatus: (c, t) => `Concept ${c} of ${t}`,
  conceptN: (n) => `Concept ${n}`,

  finalAssessment: 'Final assessment',
  intermediateTest: 'Intermediate test',
  testGeneric: 'Test',
  assessmentGateIntro: (pct) => `Pass this test (threshold ${pct}%) to unlock the next module.`,
  assessmentFinalIntro: 'Complete the final test of the course.',
  assessmentNoQuestions: 'This test has no questions yet: no assessment required.',
  masteryThreshold: (pct) => `Pass mark: ${pct}%`,
  scoreLabel: (pct) => `Score: ${pct}%. `,
  quizPass: 'Passed!',
  quizFail: 'Not passed: try again.',

  listenLesson: 'Listen to the lesson',
  audioFallback: 'Your browser does not support audio.',
  lessonEmpty: 'No content in this lesson.',

  courseCompletedTitle: 'Course completed',
  courseCompletedBody: 'You have completed every step of the course.',
  courseEndedTitle: 'Course ended',
  courseEndedFail: 'You reached the end, but not all tests were passed.',

  hintPassTest: 'Pass the test to continue.',
  hintScrollToEnd: 'Scroll to the end to continue.',

  viewSlide: 'Slide',
  viewScroll: 'Scroll',
  viewHybrid: 'Hybrid',

  loading: 'Loading the course…',

  flashcardFront: 'Front',
  flashcardBack: 'Back',
  flashcardFlip: 'Flip the card',
  carouselPrev: 'Previous',
  carouselNext: 'Next',
  carouselStatus: (c, t) => `Step ${c} of ${t}`,
  dndDropHere: 'Drag or tap here…',
  dndAllCorrect: 'All correct!',
  dndPartial: (c, t) => `${c} of ${t} correct. Tap an item to put it back in the pool.`,
  moveUp: 'Move up',
  moveDown: 'Move down',
  scenarioNoStart: 'Scenario has no start node.',
  scenarioEnd: (s) => `End of scenario. Score: ${s}`,
  scenarioRestart: 'Restart',
  transcript: 'Transcript',
  transcriptProcessing: 'Transcript in progress…',
  transcriptNone: 'No transcript available.',
  videoComing: 'Video coming soon',
  videoAlt: 'Video',
  photoCreditBy: 'Photo by ',
  photoCreditOn: ' on ',
  imagePlaceholderBadge: 'Image to insert',
  imagePlaceholderHint: 'Insert it from “Structure & content” (stock image, upload or AI generation).',
  imagePlaceholderAltLabel: 'Alt',
};

const IT: CourseLabels = {
  courseOverview: 'Panoramica del corso',
  programme: 'Programma del corso',
  objectives: 'Obiettivi',
  moduleLessons: 'Lezioni del modulo',
  moduleN: (n) => `Modulo ${n}`,
  moduleCount: (n) => `${n} ${n === 1 ? 'modulo' : 'moduli'}`,
  lessonCount: (n) => `${n} ${n === 1 ? 'lezione' : 'lezioni'}`,
  moduleWord: (n) => (n === 1 ? 'Modulo' : 'Moduli'),
  lessonWord: (n) => (n === 1 ? 'Lezione' : 'Lezioni'),

  next: 'Avanti',
  prev: 'Precedente',
  completeCourse: 'Completa corso',
  stepStatus: (c, t) => `${c} di ${t}`,

  conceptPrev: '‹ Concetto precedente',
  conceptNext: 'Concetto successivo ›',
  conceptCompleted: 'Concetto completato',
  conceptStatus: (c, t) => `Concetto ${c} di ${t}`,
  conceptN: (n) => `Concetto ${n}`,

  finalAssessment: 'Valutazione finale',
  intermediateTest: 'Test intermedio',
  testGeneric: 'Test',
  assessmentGateIntro: (pct) =>
    `Supera questo test (soglia ${pct}%) per sbloccare il modulo successivo.`,
  assessmentFinalIntro: 'Completa il test finale del corso.',
  assessmentNoQuestions: 'Questo test non ha ancora domande: nessuna valutazione richiesta.',
  masteryThreshold: (pct) => `Soglia di superamento: ${pct}%`,
  scoreLabel: (pct) => `Punteggio: ${pct}%. `,
  quizPass: 'Superato!',
  quizFail: 'Non superato: riprova.',

  listenLesson: 'Ascolta la lezione',
  audioFallback: 'Il tuo browser non supporta l’audio.',
  lessonEmpty: 'Nessun contenuto in questa lezione.',

  courseCompletedTitle: 'Corso completato',
  courseCompletedBody: 'Hai completato tutti i passi del corso.',
  courseEndedTitle: 'Corso terminato',
  courseEndedFail: 'Hai raggiunto la fine, ma non tutti i test risultano superati.',

  hintPassTest: 'Supera il test per proseguire.',
  hintScrollToEnd: 'Scorri fino in fondo per proseguire.',

  viewSlide: 'Slide',
  viewScroll: 'Scorrimento',
  viewHybrid: 'Ibrido',

  loading: 'Caricamento del corso…',

  flashcardFront: 'Fronte',
  flashcardBack: 'Retro',
  flashcardFlip: 'Gira la carta',
  carouselPrev: 'Precedente',
  carouselNext: 'Successivo',
  carouselStatus: (c, t) => `Passo ${c} di ${t}`,
  dndDropHere: 'Trascina o clicca qui…',
  dndAllCorrect: 'Tutto corretto!',
  dndPartial: (c, t) => `${c} su ${t} corretti. Clicca un elemento per rimetterlo nel pozzo.`,
  moveUp: 'Sposta su',
  moveDown: 'Sposta giù',
  scenarioNoStart: 'Scenario senza nodo iniziale.',
  scenarioEnd: (s) => `Fine scenario. Punteggio: ${s}`,
  scenarioRestart: 'Ricomincia',
  transcript: 'Trascrizione',
  transcriptProcessing: 'Trascrizione in elaborazione…',
  transcriptNone: 'Nessuna trascrizione disponibile.',
  videoComing: 'Video in arrivo',
  videoAlt: 'Video',
  photoCreditBy: 'Foto di ',
  photoCreditOn: ' su ',
  imagePlaceholderBadge: 'Immagine da inserire',
  imagePlaceholderHint: 'Inseriscila da “Struttura e contenuti” (immagine stock, upload o generazione AI).',
  imagePlaceholderAltLabel: 'Alt',
};

const SETS: Record<string, CourseLabels> = { it: IT, en: EN };

/**
 * Restituisce il set di etichette per un codice lingua BCP-47 (es. "en-US" →
 * "en"). Fallback all'inglese per lingue non supportate (lingua franca), così un
 * corso non italiano non mostra mai interfaccia in italiano.
 */
export function courseLabels(language: string | undefined | null): CourseLabels {
  const key = (language || '').slice(0, 2).toLowerCase();
  return SETS[key] ?? EN;
}
