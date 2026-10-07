import { z } from 'zod';

/**
 * Cartelle per organizzare i corsi, annidabili. Fonte di verità unica dei DTO
 * condivisi tra API e web. L'albero è costruito lato applicativo dalla lista
 * piatta (parentId).
 */

/** Nome cartella: non vuoto, lunghezza ragionevole, senza spazi ai bordi. */
export const FolderName = z
  .string()
  .trim()
  .min(1, 'Il nome della cartella è obbligatorio')
  .max(80, 'Nome troppo lungo (max 80 caratteri)');

/** Creazione di una cartella. */
export const CreateFolder = z.object({
  name: FolderName,
  /** Cartella padre (null/omesso = radice). */
  parentId: z.string().nullable().optional(),
});
export type CreateFolder = z.infer<typeof CreateFolder>;

/** Aggiornamento: rinomina e/o sposta sotto un altro padre. */
export const UpdateFolder = z.object({
  name: FolderName.optional(),
  /** `null` sposta in radice; stringa sposta sotto quel padre. */
  parentId: z.string().nullable().optional(),
});
export type UpdateFolder = z.infer<typeof UpdateFolder>;

/** Spostamento di un corso in una cartella (null = radice). */
export const MoveCourse = z.object({
  folderId: z.string().nullable(),
});
export type MoveCourse = z.infer<typeof MoveCourse>;

/** Vista piatta di una cartella con conteggio dei corsi diretti. */
export const FolderView = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  position: z.number().int(),
  /** Numero di corsi direttamente contenuti (non ricorsivo). */
  courseCount: z.number().int().nonnegative(),
});
export type FolderView = z.infer<typeof FolderView>;
