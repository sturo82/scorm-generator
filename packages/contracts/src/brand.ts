import { z } from 'zod';
import { HexColor, Id } from './primitives.js';

/**
 * Brand: insieme di asset e token applicati a un corso in fase di export
 * (Requisito 7). I token colore/tipografia vengono compilati in un theme.css
 * di CSS custom properties, senza duplicare la logica dei contenuti.
 */

export const BrandAssets = z.object({
  logoPrimaryUrl: z.string(),
  logoInverseUrl: z.string().optional(),
  faviconUrl: z.string().optional(),
});
export type BrandAssets = z.infer<typeof BrandAssets>;

export const BrandColors = z.object({
  primary: HexColor,
  onPrimary: HexColor,
  secondary: HexColor.optional(),
  surface: HexColor,
  onSurface: HexColor,
  success: HexColor,
  warning: HexColor,
  error: HexColor,
});
export type BrandColors = z.infer<typeof BrandColors>;

export const BrandTypography = z.object({
  fontFamilyHeading: z.string(),
  fontFamilyBody: z.string(),
  /** Scala tipografica opzionale (es. { h1: "2rem", body: "1rem" }). */
  scale: z.record(z.string()).optional(),
  /** URL dei web font da self-hostare nel pacchetto (offline nell'LMS). */
  webFontUrls: z.array(z.string()).optional(),
});
export type BrandTypography = z.infer<typeof BrandTypography>;

/** Tono di voce del brand: influenza i prompt di generazione (Requisito 7.4). */
export const BrandVoice = z.object({
  tone: z.string(),
  dosAndDonts: z.array(z.string()).optional(),
});
export type BrandVoice = z.infer<typeof BrandVoice>;

export const BrandLegal = z.object({
  disclaimer: z.string().optional(),
  footerText: z.string().optional(),
});
export type BrandLegal = z.infer<typeof BrandLegal>;

export const Brand = z.object({
  id: Id,
  tenantId: Id,
  name: z.string().min(1),
  assets: BrandAssets,
  colors: BrandColors,
  typography: BrandTypography,
  voice: BrandVoice.optional(),
  legal: BrandLegal.optional(),
});
export type Brand = z.infer<typeof Brand>;
