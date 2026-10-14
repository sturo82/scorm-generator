import type { Brand } from './brand.js';

/**
 * Compila un Brand in un foglio di stile `theme.css` basato su CSS custom
 * properties (Requisito 7.2 / 7.5). Fonte di verità UNICA condivisa tra il
 * builder SCORM e l'anteprima web (entrambi importano @scorm/contracts), così
 * i colori/font/logo del brand sono identici nei due contesti.
 *
 * Fallback (Requisito 7.6): quando un asset o un font non è disponibile, si usa
 * un valore di sistema sicuro, segnalato tra i `warnings`.
 */

export interface CompiledTheme {
  css: string;
  /** Avvisi su asset/font mancanti sostituiti da fallback. */
  warnings: string[];
  /** Font da self-hostare nel pacchetto (URL dichiarati dal brand). */
  fontUrls: string[];
  /** URL del logo primario del brand, se presente (per il player/anteprima). */
  logoUrl?: string;
}

const SYSTEM_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function compileTheme(brand: Brand): CompiledTheme {
  const warnings: string[] = [];

  const headingFont = sanitizeFontFamily(brand.typography.fontFamilyHeading);
  const bodyFont = sanitizeFontFamily(brand.typography.fontFamilyBody);
  const fontUrls = brand.typography.webFontUrls ?? [];
  if (fontUrls.length === 0) {
    warnings.push('Nessun web font dichiarato: uso lo stack di font di sistema come fallback.');
  }
  const logoUrl = brand.assets.logoPrimaryUrl || undefined;
  if (!logoUrl) {
    warnings.push('Logo primario mancante: verrà usato un segnaposto.');
  }

  // Colori "on-" (testo sopra una superficie) GARANTITI per contrasto WCAG AA
  // (>=4.5:1). Il brand può fornire un onPrimary/onSurface non conforme (es. un
  // brand bianco/nero con accostamenti a basso contrasto): invece di fidarci del
  // valore grezzo, lo usiamo solo se raggiunge la soglia, altrimenti scegliamo
  // bianco o nero (quello che contrasta di più sulla superficie). Gli sfondi del
  // brand (primary/secondary/surface) restano INVARIATI: è il testo sopra a
  // essere reso leggibile. Vale sia per l'anteprima sia per l'export SCORM.
  const onPrimary = readableOn(brand.colors.primary, brand.colors.onPrimary);
  const onSurface = readableOn(brand.colors.surface, brand.colors.onSurface);
  const secondary = brand.colors.secondary;
  const onSecondary = secondary ? readableOn(secondary, brand.colors.onPrimary) : undefined;
  if (onPrimary !== brand.colors.onPrimary) {
    warnings.push('Contrasto testo/primario sotto AA: adeguato automaticamente per leggibilità.');
  }
  if (onSurface !== brand.colors.onSurface) {
    warnings.push('Contrasto testo/superficie sotto AA: adeguato automaticamente per leggibilità.');
  }

  // Token colore come CSS custom properties.
  const colorTokens: Record<string, string | undefined> = {
    '--brand-primary': brand.colors.primary,
    '--brand-on-primary': onPrimary,
    '--brand-secondary': secondary,
    '--brand-on-secondary': onSecondary,
    '--brand-surface': brand.colors.surface,
    '--brand-on-surface': onSurface,
    '--brand-success': brand.colors.success,
    '--brand-warning': brand.colors.warning,
    '--brand-error': brand.colors.error,
    // Varianti in triplette HSL "H S% L%" (senza hsl()), per poter alimentare
    // sistemi di design che avvolgono i token in hsl(var(--x)) (es. i token
    // semantici Tailwind dell'anteprima web: --primary, --foreground, --card…).
    // Così l'anteprima può mappare i propri token sul brand del CORSO con lo
    // stesso contrasto AA garantito dai colori "on-".
    '--brand-primary-hsl': hexToHslTriplet(brand.colors.primary),
    '--brand-on-primary-hsl': hexToHslTriplet(onPrimary),
    '--brand-secondary-hsl': secondary ? hexToHslTriplet(secondary) : undefined,
    '--brand-on-secondary-hsl': onSecondary ? hexToHslTriplet(onSecondary) : undefined,
    '--brand-surface-hsl': hexToHslTriplet(brand.colors.surface),
    '--brand-on-surface-hsl': hexToHslTriplet(onSurface),
  };

  // Token tipografici.
  const typographyTokens: Record<string, string> = {
    '--brand-font-heading': `${headingFont}, ${SYSTEM_FONT_STACK}`,
    '--brand-font-body': `${bodyFont}, ${SYSTEM_FONT_STACK}`,
  };
  for (const [key, value] of Object.entries(brand.typography.scale ?? {})) {
    typographyTokens[`--brand-scale-${sanitizeTokenName(key)}`] = value;
  }

  const rootVars = [
    ...Object.entries(colorTokens).filter(([, v]) => v !== undefined),
    ...Object.entries(typographyTokens),
  ]
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');

  const fontFaces = fontUrls.map((url, i) => fontFaceRule(`BrandFont${i}`, url)).join('\n');

  const css = `/* theme.css — generato per il brand "${escapeComment(brand.name)}" */
${fontFaces ? fontFaces + '\n' : ''}:root {
${rootVars}
}

body {
  font-family: var(--brand-font-body);
  color: var(--brand-on-surface);
  background: var(--brand-surface);
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--brand-font-heading);
}

.brand-primary { color: var(--brand-primary); }
.brand-bg-primary { background: var(--brand-primary); color: var(--brand-on-primary); }
`;

  return { css, warnings, fontUrls, logoUrl };
}

/** Impedisce injection di CSS tramite il nome del font. */
function sanitizeFontFamily(name: string): string {
  // Ammette solo lettere, numeri, spazi e trattini: elimina qualsiasi carattere
  // che potrebbe chiudere la dichiarazione o introdurre regole CSS.
  const clean = name.replace(/[^a-zA-Z0-9\s-]/g, '').trim();
  if (!clean) return 'sans-serif';
  // Se contiene spazi, va citato.
  return /\s/.test(clean) ? `'${clean}'` : clean;
}

function sanitizeTokenName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
}

function fontFaceRule(family: string, url: string): string {
  const safeUrl = url.replace(/["'<>{};]/g, '');
  return `@font-face {
  font-family: '${family}';
  src: url('${safeUrl}');
  font-display: swap;
}`;
}

function escapeComment(s: string): string {
  return s.replace(/\*\//g, '*\\/');
}

// ── Contrasto WCAG ───────────────────────────────────────────────────────────
// Garantisce che il testo "on-" su una superficie del brand sia leggibile
// (>=4.5:1). Non altera gli sfondi del brand: sceglie solo il colore del testo.

/** Parsa un colore esadecimale (#rgb o #rrggbb) in [r,g,b] 0..255, o null. */
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Converte un hex (#rgb/#rrggbb) in una tripletta HSL "H S% L%" (senza la
 * funzione hsl()), nel formato usato dai token Tailwind. Se l'hex non è valido
 * restituisce undefined (il token verrà omesso e si userà il fallback).
 */
function hexToHslTriplet(hex: string): string | undefined {
  const rgb = parseHex(hex);
  if (!rgb) return undefined;
  const [r, g, b] = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  const H = Math.round(h * 360);
  const S = Math.round(s * 100);
  const L = Math.round(l * 100);
  return `${H} ${S}% ${L}%`;
}

/** Luminanza relativa WCAG da un colore RGB 0..255. */
function relLuminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Rapporto di contrasto WCAG tra due colori RGB. */
function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [17, 17, 17]; // quasi-nero: più morbido del nero puro

/**
 * Restituisce un colore di testo leggibile sulla superficie `surfaceHex`:
 *  - se `preferred` (quello del brand) raggiunge già AA (>=4.5:1), lo mantiene;
 *  - altrimenti sceglie bianco o nero, quello col contrasto maggiore.
 * Se la superficie non è un hex valido, lascia il valore preferito così com'è.
 */
function readableOn(surfaceHex: string, preferred: string): string {
  const surface = parseHex(surfaceHex);
  if (!surface) return preferred;
  const pref = parseHex(preferred);
  if (pref && contrastRatio(surface, pref) >= 4.5) return preferred;
  const white = contrastRatio(surface, WHITE);
  const black = contrastRatio(surface, BLACK);
  return white >= black ? '#FFFFFF' : '#111111';
}
