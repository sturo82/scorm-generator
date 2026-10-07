import type { Course } from '@scorm/contracts';

/**
 * Validazione pre-export (Requisito 9.5 / 8.3). Verifica la conformità minima
 * del corso al profilo SCORM e lo stato di approvazione editoriale. Restituisce
 * errori bloccanti e avvisi non bloccanti.
 */
export interface ValidationReport {
  errors: string[];
  warnings: string[];
  ok: boolean;
}

export interface ValidationOptions {
  /** Se true, lo stato non approvato produce warning invece di errore. */
  allowUnapproved?: boolean;
}

export function validateCourseForExport(
  course: Pick<Course, 'title' | 'modules' | 'assessments'>,
  options: ValidationOptions = {},
): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!course.title || course.title.trim().length === 0) {
    errors.push('Il corso non ha un titolo.');
  }
  const modules = course.modules ?? [];
  if (modules.length === 0) {
    errors.push('Il corso non ha moduli: nessuno SCO da esportare.');
  }

  modules.forEach((m, mi) => {
    if ((m.lessons ?? []).length === 0) {
      warnings.push(`Il modulo ${mi + 1} ("${m.title}") non ha lezioni.`);
    }
    (m.lessons ?? []).forEach((l, li) => {
      if ((l.blocks ?? []).length === 0) {
        warnings.push(`La lezione ${mi + 1}.${li + 1} ("${l.title}") non ha contenuti.`);
      }
      // Gate di approvazione editoriale (Requisito 8.3).
      if (l.editorial?.status !== 'approved') {
        const msg = `La lezione ${mi + 1}.${li + 1} ("${l.title}") non è approvata.`;
        if (options.allowUnapproved) warnings.push(msg);
        else errors.push(msg);
      }
    });
  });

  return { errors, warnings, ok: errors.length === 0 };
}
