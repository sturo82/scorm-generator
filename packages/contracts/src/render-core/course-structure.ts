/*
 * render-core/course-structure.ts — Struttura di navigazione del corso condivisa
 * tra anteprima (React) ed export SCORM (player.js). Un'unica fonte di verità per
 * la sequenza lineare di step (panoramica corso → per modulo: panoramica modulo
 * + lezioni + eventuale test intermedio → test finali) e per il raggruppamento a
 * concetti (riusa groupBlocksIntoConcepts, eliminando la copia inline nel player).
 *
 * Type-light (lavora su JSON { ... }) così da essere usata sia lato server con i
 * tipi del dominio, sia nel runtime del player dal bundle window.RenderCore.
 */

import { groupBlocksIntoConcepts, type Concept } from '../concepts.js';

export interface StructLesson {
  id: string;
  title: string;
  blocks?: unknown[];
  [k: string]: unknown;
}
export interface StructModule {
  id: string;
  title: string;
  summary?: string;
  lessons?: StructLesson[];
  [k: string]: unknown;
}
export interface StructAssessment {
  id: string;
  scope?: string;
  moduleId?: string;
  [k: string]: unknown;
}
export interface StructCourse {
  id: string;
  title: string;
  description?: string;
  modules?: StructModule[];
  assessments?: StructAssessment[];
  [k: string]: unknown;
}

export type CourseStep =
  | { kind: 'course_overview'; id: string; course: StructCourse }
  | { kind: 'module_overview'; id: string; module: StructModule; moduleIndex: number; moduleTitle: string }
  | { kind: 'lesson'; id: string; moduleTitle: string; lesson: StructLesson; moduleIndex: number; lessonIndexInModule: number }
  | { kind: 'assessment'; id: string; moduleTitle: string; assessment: StructAssessment; gate: boolean };

/**
 * Costruisce la sequenza lineare di step del corso. Gli assessment intermedi
 * (scope != 'final', con moduleId) sono inseriti dopo le lezioni del loro
 * modulo; i finali in coda. Identico per anteprima ed export.
 */
export function buildCourseSteps(course: StructCourse): CourseStep[] {
  const steps: CourseStep[] = [];
  const assessments = course.assessments || [];
  const intermediateByModule: Record<string, StructAssessment[]> = {};
  const finals: StructAssessment[] = [];
  for (const a of assessments) {
    if (a.scope === 'final') finals.push(a);
    else if (a.moduleId) (intermediateByModule[a.moduleId] = intermediateByModule[a.moduleId] || []).push(a);
  }

  steps.push({ kind: 'course_overview', id: 'overview:course', course });

  (course.modules || []).forEach((m, mi) => {
    steps.push({ kind: 'module_overview', id: 'overview:mod:' + m.id, module: m, moduleIndex: mi, moduleTitle: m.title });
    (m.lessons || []).forEach((l, li) => {
      steps.push({
        kind: 'lesson',
        id: 'lesson:' + l.id,
        moduleTitle: m.title,
        lesson: l,
        moduleIndex: mi,
        lessonIndexInModule: li,
      });
    });
    (intermediateByModule[m.id] || []).forEach((a) => {
      steps.push({ kind: 'assessment', id: 'assess:' + a.id, moduleTitle: m.title, assessment: a, gate: true });
    });
  });
  finals.forEach((a) => {
    steps.push({ kind: 'assessment', id: 'assess:' + a.id, moduleTitle: 'Valutazione finale', assessment: a, gate: false });
  });
  return steps;
}

/** Raggruppa i blocchi di una lezione in concetti (riusa l'euristica condivisa). */
export function groupConcepts(blocks: unknown[] | undefined | null): Concept[] {
  return groupBlocksIntoConcepts((blocks as never) || []);
}

export type { Concept } from '../concepts.js';
