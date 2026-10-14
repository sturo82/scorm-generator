/**
 * Nome dell'applicazione (brand FISSO della piattaforma). Non è modificabile dai
 * tenant: il white-label del tenant riguarda solo il proprio nome visibile e il
 * logo (vedi AppBranding), non il brand della piattaforma.
 *
 * Centralizzato qui così un eventuale rebranding si fa in un punto solo.
 */
export const APP_NAME = 'K Scorm';

/**
 * Compone il titolo della scheda del browser: "<nome tenant> · <nome app>".
 * Se il tenant non ha un nome visibile proprio, usa solo il nome dell'app.
 */
export function composeDocumentTitle(tenantName?: string | null): string {
  const t = tenantName?.trim();
  return t && t !== APP_NAME ? `${t} · ${APP_NAME}` : APP_NAME;
}
