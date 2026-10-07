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
