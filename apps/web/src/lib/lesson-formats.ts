import type { LessonFormatValue } from '@/lib/api/types';

/**
 * Descrizione unica dei formati di lezione, usata dalla creazione guidata e dall'editor del corso:
 * dice in chiaro che cosa si ottiene, quanto dura e se servono video da produrre.
 */
export interface LessonFormatInfo {
  value: LessonFormatValue;
  label: string;
  /** Una frase: a che cosa serve. */
  summary: string;
  /** Che cosa produce, in punti brevi. */
  outputs: string[];
  /** Tempo di fruizione indicativo. */
  duration: string;
  /** Che cosa c'è di video e quando arriva. */
  video: string;
}

export const LESSON_FORMATS: LessonFormatInfo[] = [
  {
    value: 'standard',
    label: 'Lezione di studio',
    summary: 'Teoria, definizioni, procedure e checklist da leggere e provare.',
    outputs: ['Testi brevi per concetto con immagini', 'Slide scorrevoli, schemi e box di approfondimento', 'Attività di verifica vicino al contenuto'],
    duration: '10-15 min',
    video: 'Nessun video: si studia anche senza audio.',
  },
  {
    value: 'video_first',
    label: 'Lezione con video',
    summary: 'Un video portante (dimostrazione, caso reale) con capitoli e domande.',
    outputs: ['Spazio per il video con capitoli e trascrizione', 'Domande durante il video', 'Quiz e punti chiave accanto'],
    duration: '8-15 min',
    video: 'Il video lo aggiungi tu dopo la generazione (caricandolo o creandolo con un avatar).',
  },
  {
    value: 'pillola',
    label: 'Pillola',
    summary: 'Micro-lezione su un solo concetto, da ripassare o applicare subito.',
    outputs: ['Un mini-video di aggancio', 'Spiegazione sintetica', 'Verifica rapida e riepilogo finale'],
    duration: '2-4 min',
    video: 'Il mini-video (cartoon) viene creato in automatico e arriva qualche minuto dopo il testo.',
  },
  {
    value: 'pillola_interattiva',
    label: 'Pillola interattiva',
    summary: 'Una situazione reale in cui scegli cosa fare e scopri le conseguenze di ogni scelta.',
    outputs: ['Una storia a bivi con 2-3 decisioni', 'Per ogni scelta, cosa succede e perché', 'Finale positivo o negativo, con la lezione da ricordare'],
    duration: '3-6 min',
    video: 'Una clip cartoon per ogni scena, creata in automatico: arrivano qualche minuto dopo il testo.',
  },
];

export const lessonFormatInfo = (v: LessonFormatValue): LessonFormatInfo => LESSON_FORMATS.find((f) => f.value === v) ?? LESSON_FORMATS[0]!;
