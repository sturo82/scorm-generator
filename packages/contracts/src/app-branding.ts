import { z } from 'zod';

/**
 * Sotto-brand del TENANT per la web app (distinto dai Brand dei corsi e dal
 * brand FISSO della piattaforma): un nome visibile e un logo che rendono il
 * tenant riconoscibile nell'intestazione, SENZA alterare il tema generale
 * dell'app (colori, favicon, aspetto). Salvato come JSONB su Tenant.branding e
 * validato qui (fonte di verità unica).
 *
 * Nota storica: in passato questo schema conteneva anche colore primario/accent/
 * header e favicon, che sovrascrivevano il tema dell'intera piattaforma. Sono
 * stati rimossi: la piattaforma ha un brand fisso; il tenant personalizza solo
 * nome + logo mostrati in un punto contenuto (sidebar/header).
 */

export const AppBranding = z.object({
  /** Nome visibile del tenant, mostrato accanto al logo in sidebar/header e nel
   *  titolo della scheda. Vuoto/assente → si usa il nome dell'app di default. */
  appName: z.string().trim().min(1).max(40).nullable().default(null),
  /** Chiave storage del logo (SVG/PNG); URL firmato risolto a lettura. */
  logoKey: z.string().nullable().default(null),
});
export type AppBranding = z.infer<typeof AppBranding>;

/** Vista del branding per il client: aggiunge l'URL firmato del logo. */
export const AppBrandingView = AppBranding.extend({
  logoUrl: z.string().nullable().default(null),
});
export type AppBrandingView = z.infer<typeof AppBrandingView>;

/** Patch del branding (solo il nome visibile; il logo va via upload). */
export const UpdateAppBranding = z.object({
  appName: z.string().trim().min(1).max(40).nullable().optional(),
});
export type UpdateAppBranding = z.infer<typeof UpdateAppBranding>;
