/**
 * Porta per le librerie di immagini stock royalty-free (Unsplash, Pexels)
 * (Requisito 4.2 / 5.5 / 10). Astrae il provider concreto. La ricerca ritorna
 * metadati + anteprima; il fetch a piena risoluzione scarica i byte (che l'app
 * salverà su storage per l'export offline) e l'attribuzione obbligatoria.
 *
 * Nota licenze: Unsplash richiede di accreditare l'autore e di "tracciare" i
 * download (chiamata all'endpoint download_location). L'adapter incapsula questo
 * requisito dentro fetchFull, così il dominio resta neutro.
 */

/** Attribuzione obbligatoria di un'immagine stock. */
export interface StockAttribution {
  provider: string;
  authorName: string;
  authorUrl?: string;
  sourceUrl?: string;
}

/** Un risultato di ricerca (nessun byte scaricato). */
export interface StockPhoto {
  id: string;
  provider: string;
  thumbUrl: string;
  alt: string;
  attribution: StockAttribution;
  width?: number;
  height?: number;
}

/** Byte a piena risoluzione + metadati, pronti per il salvataggio su storage. */
export interface StockPhotoAsset {
  bytes: Uint8Array;
  contentType: string;
  alt: string;
  attribution: StockAttribution;
}

export interface StockImageProvider {
  readonly id: string;
  /** Cerca foto per query testuale. `perPage` limita i risultati. */
  search(query: string, opts?: { perPage?: number }): Promise<StockPhoto[]>;
  /**
   * Scarica l'immagine a piena risoluzione (e, dove richiesto dal provider,
   * registra il download per conformità alla licenza). Ritorna byte +
   * attribuzione da persistere nel MediaRef.
   */
  fetchFull(photoId: string): Promise<StockPhotoAsset>;
}
