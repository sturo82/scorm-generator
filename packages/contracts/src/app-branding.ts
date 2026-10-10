import { z } from 'zod';
import { HexColor } from './primitives.js';

/**
 * Branding white-label della PIATTAFORMA, per-tenant (distinto dai Brand dei
 * corsi): nome app, logo, favicon e palette colori mostrati nella web app.
 * Salvato come JSONB su Tenant.branding e validato qui (fonte di verità unica).
 */

export const AppBranding = z.object({
  /** Nome dell'applicazione mostrato in header, sidebar, titolo pagina. */
  appName: z.string().trim().min(1).max(40).default('K Scorm'),
  /** Colore primario del tema della web app (bottoni, link, ring). */
  primaryColor: HexColor.default('#22b573'),
  /** Colore accent/highlight (CTA secondarie, badge, stati attivi). Opzionale:
   *  se assente il provider lo deriva dal primario. */
  accentColor: HexColor.nullable().default(null),
  /** Colore dell'header (barra superiore): gradiente da questo a una variante
   *  più profonda. Opzionale: se assente, il provider usa il primario. */
  headerColor: HexColor.nullable().default(null),
  /** Chiave storage del logo (SVG/PNG); URL firmato risolto a lettura. */
  logoKey: z.string().nullable().default(null),
  /** Chiave storage della favicon (PNG/SVG/ICO); URL firmato a lettura. */
  faviconKey: z.string().nullable().default(null),
});
export type AppBranding = z.infer<typeof AppBranding>;

/** Vista del branding per il client: aggiunge gli URL firmati risolti. */
export const AppBrandingView = AppBranding.extend({
  logoUrl: z.string().nullable().default(null),
  faviconUrl: z.string().nullable().default(null),
});
export type AppBrandingView = z.infer<typeof AppBrandingView>;

/** Patch del branding (campi testuali/colore; gli asset vanno via upload). */
export const UpdateAppBranding = z.object({
  appName: z.string().trim().min(1).max(40).optional(),
  primaryColor: HexColor.optional(),
  accentColor: HexColor.nullable().optional(),
  headerColor: HexColor.nullable().optional(),
});
export type UpdateAppBranding = z.infer<typeof UpdateAppBranding>;
