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

  // Token colore come CSS custom properties.
  const colorTokens: Record<string, string | undefined> = {
    '--brand-primary': brand.colors.primary,
    '--brand-on-primary': brand.colors.onPrimary,
    '--brand-secondary': brand.colors.secondary,
    '--brand-surface': brand.colors.surface,
    '--brand-on-surface': brand.colors.onSurface,
    '--brand-success': brand.colors.success,
    '--brand-warning': brand.colors.warning,
    '--brand-error': brand.colors.error,
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
