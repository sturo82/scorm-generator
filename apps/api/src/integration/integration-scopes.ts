/**
 * Scopi concedibili a un IntegrationClient. Limitano cosa un token di servizio
 * può fare. Aggiungere qui nuovi scopi man mano che l'API di integrazione cresce.
 */
export const INTEGRATION_SCOPES = {
  /** Leggere il catalogo dei corsi condivisibili (metadati). */
  CATALOG_READ: 'catalog:read',
  /** Ottenere il link di download di un pacchetto SCORM. */
  PACKAGE_DOWNLOAD: 'package:download',
} as const;

export type IntegrationScope = (typeof INTEGRATION_SCOPES)[keyof typeof INTEGRATION_SCOPES];

/** Tutti gli scopi noti (per validazione in fase di creazione client). */
export const ALL_INTEGRATION_SCOPES: IntegrationScope[] = Object.values(INTEGRATION_SCOPES);

/** Insieme di default assegnato a un nuovo client se non specificato. */
export const DEFAULT_INTEGRATION_SCOPES: IntegrationScope[] = [
  INTEGRATION_SCOPES.CATALOG_READ,
  INTEGRATION_SCOPES.PACKAGE_DOWNLOAD,
];
