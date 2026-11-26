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

/** Tipo di contenuto che la cartella organizza (alberi separati). */
export const FolderKind = z.enum(['COURSE', 'PODCAST']);
export type FolderKind = z.infer<typeof FolderKind>;

/** Creazione di una cartella. */
export const CreateFolder = z.object({
  /** Tipo di contenuto (default: corsi). */
  kind: FolderKind.default('COURSE'),
  name: FolderName,
  /** Cartella padre (null/omesso = radice). */
  parentId: z.string().nullable().optional(),
});
export type CreateFolder = z.input<typeof CreateFolder>;

/** Aggiornamento: rinomina e/o sposta sotto un altro padre. */
export const UpdateFolder = z.object({
  name: FolderName.optional(),
  /** `null` sposta in radice; stringa sposta sotto quel padre. */
  parentId: z.string().nullable().optional(),
});
export type UpdateFolder = z.infer<typeof UpdateFolder>;

/** Spostamento di un corso o di un podcast in una cartella (null = radice). */
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
  kind: FolderKind,
  /** Numero di elementi (corsi o podcast, secondo `kind`) direttamente contenuti (non ricorsivo). */
  courseCount: z.number().int().nonnegative(),
});
export type FolderView = z.infer<typeof FolderView>;
