import { z } from 'zod';

/** Richiesta di creare una knowledge strutturata a partire da documenti già caricati. */
export const StructureKnowledge = z
  .object({
    /** Documenti sorgente (devono essere pronti). */
    documentIds: z.array(z.string().min(1)).min(1).max(10),
    /** Titolo del documento strutturato che verrà creato. */
    title: z.string().trim().min(1).max(160),
    /** Dove salvare il risultato: nella knowledge globale o tra le fonti di un corso. */
    scope: z.enum(['GLOBAL', 'COURSE']).default('GLOBAL'),
    courseId: z.string().min(1).optional(),
    /** Lingua del documento prodotto (codice breve). */
    language: z.string().min(2).max(8).default('it'),
  })
  .refine((v) => v.scope !== 'COURSE' || !!v.courseId, {
    message: 'courseId obbligatorio con scope COURSE',
    path: ['courseId'],
  });
export type StructureKnowledge = z.infer<typeof StructureKnowledge>;
