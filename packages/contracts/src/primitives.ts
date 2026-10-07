import { z } from 'zod';

/**
 * Primitive condivise tra i modelli di contenuto.
 * Un'unica fonte di verità (Zod) da cui derivano sia i tipi TypeScript sia i
 * JSON Schema usati per la generazione strutturata AI.
 */

/** Identificatore stabile di un'entità di contenuto (lato dominio, non DB). */
export const Id = z.string().min(1).max(128);
export type Id = z.infer<typeof Id>;

/** Codice lingua BCP-47 (es. "it", "en-US"). */
export const LanguageCode = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'Codice lingua BCP-47 non valido');
export type LanguageCode = z.infer<typeof LanguageCode>;

/** Colore esadecimale (#RGB, #RRGGBB, #RRGGBBAA). */
export const HexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Colore esadecimale non valido');
export type HexColor = z.infer<typeof HexColor>;

/**
 * Rich text del contenuto didattico. HTML limitato che verrà comunque
 * sanificato prima di finire nel pacchetto SCORM (Requisito 12.3).
 */
export const RichText = z.object({
  format: z.literal('html'),
  html: z.string(),
});
export type RichText = z.infer<typeof RichText>;

/** Sorgente di un media video: file caricato (storage) o embed esterno. */
export const MediaSource = z.enum(['upload', 'youtube', 'vimeo', 'twitch']);
export type MediaSource = z.infer<typeof MediaSource>;

/** Riferimento a un media. In v1 i media sono placeholder (Requisito 4.2). */
export const MediaRef = z.object({
  kind: z.enum(['image', 'video', 'audio']),
  /** Chiave nello storage oggetti; assente finché è un placeholder. */
  storageKey: z.string().optional(),
  /** Testo alternativo per l'accessibilità (Requisito 5.5). */
  alt: z.string().default(''),
  /** Prompt descrittivo per sostituire il placeholder in revisione. */
  placeholderPrompt: z.string().optional(),
  /**
   * Sorgente del video. 'upload' (default) = file su storage (storageKey);
   * youtube/vimeo/twitch = embed esterno via externalId/externalUrl. Gli embed
   * esterni richiedono rete a runtime (anche nel pacchetto SCORM) e non
   * supportano la trascrizione ASR automatica (nessun file da analizzare).
   */
  source: MediaSource.default('upload'),
  /** URL originale del video esterno (es. link YouTube/Vimeo/Twitch). */
  externalUrl: z.string().optional(),
  /** Id del video sulla piattaforma esterna (es. videoId YouTube). */
  externalId: z.string().optional(),
});
export type MediaRef = z.infer<typeof MediaRef>;

/** Provenienza di un contenuto generato tramite RAG (Requisito 3.6 / 4.8). */
export const SourceCitation = z.object({
  documentId: Id,
  documentName: z.string(),
  section: z.string().optional(),
});
export type SourceCitation = z.infer<typeof SourceCitation>;

/** Stato editoriale per il flusso human-in-the-loop (Requisito 8.2). */
export const EditorialStatus = z.enum(['draft', 'in_review', 'approved']);
export type EditorialStatus = z.infer<typeof EditorialStatus>;

/** Metadati editoriali comuni agli elementi rivedibili. */
export const EditorialMeta = z.object({
  status: EditorialStatus.default('draft'),
  citations: z.array(SourceCitation).default([]),
});
export type EditorialMeta = z.infer<typeof EditorialMeta>;
