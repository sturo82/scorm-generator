import { describe, it, expect } from 'vitest';
import type { Brand } from '@scorm/contracts';
import { compileTheme } from './theme-compiler.js';

const baseBrand: Brand = {
  id: 'b1',
  tenantId: 't1',
  name: 'Acme',
  assets: { logoPrimaryUrl: 'https://cdn/logo.svg' },
  colors: {
    primary: '#0055FF',
    onPrimary: '#FFFFFF',
    surface: '#FFFFFF',
    onSurface: '#111111',
    success: '#2E7D32',
    warning: '#ED6C02',
    error: '#D32F2F',
  },
  typography: {
    fontFamilyHeading: 'Inter',
    fontFamilyBody: 'Inter',
    webFontUrls: ['https://cdn/inter.woff2'],
  },
};

describe('compileTheme', () => {
  it('genera CSS custom properties dai token colore', () => {
    const { css } = compileTheme(baseBrand);
    expect(css).toContain('--brand-primary: #0055FF;');
    expect(css).toContain('--brand-on-primary: #FFFFFF;');
    expect(css).toContain('--brand-error: #D32F2F;');
  });

  it('emette anche le triplette HSL dei token (per i design system basati su hsl(var(--x)))', () => {
    const { css } = compileTheme(baseBrand);
    // #0055FF → hsl(220 100% 50%); #FFFFFF → 0 0% 100%; #111111 → 0 0% 7%.
    expect(css).toContain('--brand-primary-hsl: 220 100% 50%;');
    expect(css).toContain('--brand-on-primary-hsl: 0 0% 100%;');
    expect(css).toContain('--brand-surface-hsl: 0 0% 100%;');
    expect(css).toContain('--brand-on-surface-hsl: 0 0% 7%;');
  });

  it('include le @font-face per i web font dichiarati e li elenca', () => {
    const theme = compileTheme(baseBrand);
    expect(theme.css).toContain('@font-face');
    expect(theme.css).toContain('inter.woff2');
    expect(theme.fontUrls).toEqual(['https://cdn/inter.woff2']);
  });

  it('avvisa quando mancano i web font (fallback di sistema)', () => {
    const brand: Brand = {
      ...baseBrand,
      typography: { fontFamilyHeading: 'Inter', fontFamilyBody: 'Inter' },
    };
    const { warnings, css } = compileTheme(brand);
    expect(warnings.some((w) => /font/i.test(w))).toBe(true);
    expect(css).toContain('sans-serif');
  });

  it('avvisa quando manca il logo primario', () => {
    const brand = { ...baseBrand, assets: { logoPrimaryUrl: '' } };
    const { warnings } = compileTheme(brand);
    expect(warnings.some((w) => /logo/i.test(w))).toBe(true);
  });

  it('sanifica i nomi dei font contro injection CSS', () => {
    const brand: Brand = {
      ...baseBrand,
      typography: {
        fontFamilyHeading: "Evil'}; body{display:none}",
        fontFamilyBody: 'Inter',
      },
    };
    const { css } = compileTheme(brand);
    expect(css).not.toContain('display:none');
  });

  it('corregge i colori "on-" sotto contrasto AA (es. testo chiaro su superficie chiara)', () => {
    // Superficie bianca con onSurface bianco: contrasto 1:1, illeggibile.
    const brand: Brand = {
      ...baseBrand,
      colors: { ...baseBrand.colors, surface: '#FFFFFF', onSurface: '#FFFFFF' },
    };
    const { css, warnings } = compileTheme(brand);
    // Il testo su superficie viene reso scuro (quasi-nero) per leggibilità.
    expect(css).toContain('--brand-on-surface: #111111;');
    expect(warnings.some((w) => /contrasto/i.test(w))).toBe(true);
  });

  it('mantiene un colore "on-" che già rispetta AA', () => {
    // onPrimary bianco su primario blu scuro: contrasto ampio, invariato.
    const { css } = compileTheme(baseBrand);
    expect(css).toContain('--brand-on-primary: #FFFFFF;');
  });

  it('deriva --brand-on-secondary leggibile quando c\'è il colore secondario', () => {
    const brand: Brand = {
      ...baseBrand,
      colors: { ...baseBrand.colors, secondary: '#111111' },
    };
    const { css } = compileTheme(brand);
    // Su secondario quasi-nero il testo deve essere bianco.
    expect(css).toContain('--brand-on-secondary: #FFFFFF;');
  });

  it('gestisce la scala tipografica opzionale', () => {
    const brand: Brand = {
      ...baseBrand,
      typography: { ...baseBrand.typography, scale: { h1: '2rem', body: '1rem' } },
    };
    const { css } = compileTheme(brand);
    expect(css).toContain('--brand-scale-h1: 2rem;');
    expect(css).toContain('--brand-scale-body: 1rem;');
  });
});
