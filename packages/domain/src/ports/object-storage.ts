/**
 * Porta per lo storage degli oggetti (file sorgente, media, pacchetti SCORM).
 * Default: S3 (in dev: MinIO). L'accesso avviene tramite URL firmati a scadenza
 * (Requisito 12.4), mai pubblici.
 */

export interface ObjectMetadata {
  contentType?: string;
  /** Metadati arbitrari (es. tenantId, documentId) per tracciabilità. */
  custom?: Record<string, string>;
}

export interface SignedUrlOptions {
  expiresInSec: number;
  /**
   * Nome file suggerito al browser per il download (Content-Disposition:
   * attachment). Serve perché, con URL S3 cross-origin, l'attributo HTML
   * `download` viene ignorato: il nome del file lo detta la response.
   */
  downloadFilename?: string;
}

/** Body accettati per il put; Buffer per semplicità, stream per file grandi. */
export type ObjectBody = Buffer | Uint8Array | NodeJS.ReadableStream;

export interface ObjectStorage {
  readonly id: string;
  putObject(key: string, body: ObjectBody, meta?: ObjectMetadata): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  getSignedUrl(key: string, opts: SignedUrlOptions): Promise<string>;
  deleteObject(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
