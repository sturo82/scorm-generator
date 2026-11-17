/**
 * Destinazione di un import "video da slide": un CORSO (id del corso) oppure la LIBRERIA
 * video del tenant, indicata dall'id riservato `library` (gli id dei corsi sono cuid, quindi
 * non possono coincidere). In libreria non c'è un corso da verificare, i costi non si
 * attribuiscono a un corso e il montaggio crea video in libreria invece di moduli e quiz.
 */
export const LIBRARY_OWNER = 'library';

export function isLibrary(courseId: string): boolean {
  return courseId === LIBRARY_OWNER;
}

/** Corso a cui attribuire i costi (null per la libreria). */
export function meterCourseId(courseId: string): string | null {
  return isLibrary(courseId) ? null : courseId;
}
