import { z } from 'zod';
import { Id } from './primitives.js';

/**
 * Ricerca e selezione di immagini da librerie stock royalty-free (Unsplash,
 * Pexels). DTO condivisi tra API e web. Il risultato di ricerca espone l'URL di
 * anteprima (per la griglia) e i metadati di attribuzione; alla selezione l'API
 * scarica i byte dell'immagine a piena risoluzione e li salva su storage (per
 * l'export SCORM offline), scrivendo poi storageKey + attribuzione nel MediaRef.
 */

/** Un risultato di ricerca stock (dati dal provider, nessun byte scaricato). */
export const StockImageResult = z.object({
  /** Id della foto presso il provider (serve all'attach). */
  id: z.string(),
  /** Provider di origine (es. 'unsplash', 'pexels'). */
  provider: z.string(),
  /** URL anteprima (thumbnail) per la griglia di scelta. */
  thumbUrl: z.string(),
  /** Testo alternativo/descrizione, se fornito dal provider. */
  alt: z.string().default(''),
  /** Nome autore da accreditare. */
  authorName: z.string(),
  /** URL profilo autore, se disponibile. */
  authorUrl: z.string().optional(),
  /** URL pagina originale della foto. */
  sourceUrl: z.string().optional(),
  /** Larghezza/altezza originali (per layout/ratio), se note. */
  width: z.number().int().optional(),
  height: z.number().int().optional(),
});
export type StockImageResult = z.infer<typeof StockImageResult>;

/** Risposta della ricerca stock. */
export const StockImageSearchResponse = z.object({
  provider: z.string(),
  results: z.array(StockImageResult),
});
export type StockImageSearchResponse = z.infer<typeof StockImageSearchResponse>;

/**
 * Input per collegare un'immagine stock scelta a un MediaRef di un block.
 * `blockId` individua il block; `mediaRefId`/`mediaIndex` sono opzionali per
 * disambiguare quale MediaRef immagine aggiornare (default: il primo del block).
 */
export const AttachStockImageInput = z.object({
  blockId: Id,
  /** Id della foto presso il provider. */
  photoId: z.string(),
  /** Provider (deve combaciare con quello configurato). */
  provider: z.string(),
  /** Indice dell'immagine nel block (per i block con array media, es. rich_text). */
  mediaIndex: z.number().int().min(0).optional(),
  /** Testo alternativo da impostare sull'immagine (accessibilità). */
  alt: z.string().optional(),
});
export type AttachStockImageInput = z.infer<typeof AttachStockImageInput>;

/**
 * Input per impostare un'immagine stock come COPERTINA (corso o modulo). Non
 * serve un block: l'immagine è scaricata e salvata come coverImageKey, con
 * l'attribuzione obbligatoria memorizzata accanto.
 */
export const AttachStockCoverInput = z.object({
  /** Id della foto presso il provider. */
  photoId: z.string(),
  /** Provider (deve combaciare con quello configurato). */
  provider: z.string(),
});
export type AttachStockCoverInput = z.infer<typeof AttachStockCoverInput>;
