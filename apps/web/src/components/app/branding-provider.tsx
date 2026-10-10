'use client';

import * as React from 'react';
import { useBranding } from '@/lib/api/hooks';

/**
 * Applica il branding white-label del tenant alla web app lato client:
 *  - titolo del documento (nome app),
 *  - favicon (link rel=icon) se personalizzata — sovrascrivendo l'href della
 *    favicon di default K Scorm dichiarata nei metadata del layout,
 *  - palette del tema DERIVATA dal colore primario del brand: oltre a
 *    --primary/--ring, deriviamo accent, gradienti di sfondo/header, bordi e
 *    ombre colorate così l'intera UI assume un look premium coerente col brand.
 *
 * È resiliente: se il branding non è ancora caricato (o fallisce) la UI resta
 * sul tema di default definito in CSS.
 */
export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { data } = useBranding();

  // Titolo pagina
  React.useEffect(() => {
    if (data?.appName) document.title = data.appName;
  }, [data?.appName]);

  // Favicon personalizzata. Next App Router inietta i <link rel="icon"> dai
  // metadata come "hoistable resource" di React DOM: eliminarli dal DOM causa un
  // crash in React (unmountHoistable → removeChild su nodo già rimosso).
  // Soluzione: NON rimuoviamo il link di Next, ma ne sovrascriviamo l'href in
  // modo che il browser carichi la nostra favicon. Se il branding non ha favicon
  // custom, lo lasciamo puntare al default.
  React.useEffect(() => {
    const head = document.head;
    const href = data?.faviconUrl || '/favicon-32.png';

    // 1) Aggiorna tutti i <link rel="icon"> GIÀ nel DOM (sia di Next sia nostri).
    //    Così Next non perde il nodo e React DOM non crasha.
    const existingIcons = head.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');
    if (existingIcons.length > 0) {
      existingIcons.forEach((el) => {
        el.href = href;
        const type = faviconType(href);
        if (type) el.type = type;
        else el.removeAttribute('type');
      });
    } else {
      // Nessun link icon nel DOM: ne creiamo uno (caso raro, es. prima del SSR).
      const link = document.createElement('link');
      link.rel = 'icon';
      link.href = href;
      const type = faviconType(href);
      if (type) link.type = type;
      link.setAttribute('data-branding-favicon', 'true');
      head.appendChild(link);
    }
  }, [data?.faviconUrl]);

  // Palette derivata dai colori del brand. Tre colori in input (primario +
  // accent opzionale + header opzionale) → set coerente di token (primario,
  // hover, accent, superfici, header, bordi, ombre) per una resa enterprise.
  // Se non ci sono campi, si rimuovono gli override e il tema CSS di default
  // riprende il controllo.
  React.useEffect(() => {
    const root = document.documentElement;
    const primary = data?.primaryColor ? hexToHsl(data.primaryColor) : null;
    const accent = data?.accentColor ? hexToHsl(data.accentColor) : null;
    const header = data?.headerColor ? hexToHsl(data.headerColor) : null;

    // Token derivati dal brand (chiave CSS → valore). null = rimuovi override.
    const vars: Record<string, string | null> = primary
      ? deriveBrandTokens(primary, accent, header)
      : {
          '--primary': null,
          '--primary-foreground': null,
          '--ring': null,
          '--accent': null,
          '--accent-foreground': null,
          '--sidebar-accent': null,
          '--app-gradient-a': null,
          '--app-gradient-b': null,
          '--header-gradient-a': null,
          '--header-gradient-b': null,
          '--header-foreground': null,
          '--brand-glow': null,
          '--shadow-color': null,
        };

    for (const [k, v] of Object.entries(vars)) {
      if (v == null) root.style.removeProperty(k);
      else root.style.setProperty(k, v);
    }
  }, [data?.primaryColor, data?.accentColor, data?.headerColor]);

  return <>{children}</>;
}

/** MIME per <link type> dedotto dall'estensione/URL della favicon. */
function faviconType(href: string): string | null {
  const clean = href.split('?')[0]?.toLowerCase() ?? '';
  if (clean.endsWith('.svg')) return 'image/svg+xml';
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.ico')) return 'image/x-icon';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
  return null; // URL firmato senza estensione: lascia decidere al browser
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

/**
 * Deriva un set completo di CSS var dal brand. Tre colori in input:
 *  - `c`: primario (obbligatorio) — bottoni, link, ring, glow.
 *  - `acc`: accent/highlight (opzionale) — CTA secondarie, badge, hover attivi.
 *          Se assente, derivato dal primario.
 *  - `hdr`: header (opzionale) — gradiente barra superiore e ombre.
 *          Se assente, derivato dal primario.
 * I valori sono nel formato "H S% L%" atteso dalle var del tema (hsl(var(--x))).
 */
function deriveBrandTokens(c: Hsl, acc: Hsl | null, hdr: Hsl | null): Record<string, string> {
  const trip = (h: number, s: number, l: number) =>
    `${Math.round(((h % 360) + 360) % 360)} ${clamp(s, 0, 100)}% ${clamp(l, 0, 100)}%`;

  // WCAG AA: le superfici che portano testo (bottoni "primary", header) devono
  // dare contrasto >=4.5:1 col loro foreground. I colori del tenant sono
  // arbitrari, quindi scuriamo la tinta finché il testo bianco è leggibile e,
  // se nemmeno così basta (tinta troppo chiara/satura), usiamo testo scuro.
  const primarySurface = ensureReadableSurface(c);
  const hd0 = hdr ?? c;
  const headerSurface = ensureReadableSurface(hd0);

  // Accent: dal campo dedicato oppure derivato dal primario (tinta chiara).
  const a = acc ?? { h: c.h, s: Math.min(c.s, 70), l: 55 };
  // Foreground dell'accent soft: tinta scura dell'accent, con contrasto AA sul
  // fondo chiaro dell'accent (L~94).
  const accentFg = ensureReadableOn(
    { h: a.h, s: Math.min(a.s + 10, 90), l: Math.max(a.l - 18, 24) },
    { h: a.h, s: Math.min(a.s, 70), l: 94 },
  );
  return {
    '--primary': trip(primarySurface.bg.h, primarySurface.bg.s, primarySurface.bg.l),
    '--primary-foreground': primarySurface.fg,
    // Ring = tinta primaria scurita: focus indicator con contrasto adeguato.
    '--ring': trip(primarySurface.bg.h, primarySurface.bg.s, primarySurface.bg.l),
    // Accent tenue (sfondo di stati hover/selezione): molto chiaro dal colore accent.
    '--accent': trip(a.h, Math.min(a.s, 70), 94),
    '--accent-foreground': trip(accentFg.h, accentFg.s, accentFg.l),
    '--sidebar-accent': trip(a.h, Math.min(a.s, 70), 92),
    // Gradiente di sfondo app: velo diffuso della tinta primaria.
    '--app-gradient-a': trip(c.h, Math.min(c.s, 72), 94),
    '--app-gradient-b': trip(c.h, 24, 98),
    // Gradiente dell'header: dalla tinta header leggibile a una più profonda.
    '--header-gradient-a': trip(headerSurface.bg.h, headerSurface.bg.s, headerSurface.bg.l),
    '--header-gradient-b': trip(
      headerSurface.bg.h + 12,
      Math.min(headerSurface.bg.s + 4, 92),
      Math.max(headerSurface.bg.l - 7, 10),
    ),
    '--header-foreground': headerSurface.fg,
    // Alone/glow colorato per bagliori ed evidenziazioni (decorativo, niente testo).
    '--brand-glow': trip(c.h, c.s, c.l),
    // Ombra colorata (brand) per profondità premium.
    '--shadow-color': trip(hd0.h, Math.min(hd0.s + 10, 90), Math.max(hd0.l - 26, 10)),
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, n)));
}

// ── Helper contrasto WCAG ────────────────────────────────────────────────────

/** Luminanza relativa (WCAG) da HSL. */
function relLuminance({ h, s, l }: Hsl): number {
  const [r, g, b] = hslToRgb(h, s, l);
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Rapporto di contrasto WCAG tra due colori HSL. */
function contrast(a: Hsl, b: Hsl): number {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE: Hsl = { h: 0, s: 0, l: 100 };
const NEAR_BLACK = (h: number): Hsl => ({ h, s: 30, l: 12 });

/**
 * Rende una tinta usabile come SUPERFICIE con testo sopra, garantendo >=4.5:1.
 * Strategia: prova il testo bianco scurendo progressivamente la tinta; se la
 * tinta è così chiara che il bianco non basta mai, usa testo quasi-nero.
 * Ritorna il colore di sfondo (eventualmente scurito) e il foreground scelto.
 */
function ensureReadableSurface(c: Hsl): { bg: Hsl; fg: string } {
  const trip = (x: Hsl) => `${Math.round(((x.h % 360) + 360) % 360)} ${clamp(x.s, 0, 100)}% ${clamp(x.l, 0, 100)}%`;
  // 1) testo bianco: scurisci la L finché contrasto >=4.5 (fino a L minimo 20).
  for (let l = c.l; l >= 20; l -= 1) {
    const bg = { h: c.h, s: c.s, l };
    if (contrast(bg, WHITE) >= 4.5) return { bg, fg: '0 0% 100%' };
  }
  // 2) tinta troppo chiara per il bianco: usa testo quasi-nero sulla tinta
  //    originale (schiarita se serve) finché contrasto >=4.5.
  const dark = NEAR_BLACK(c.h);
  for (let l = c.l; l <= 96; l += 1) {
    const bg = { h: c.h, s: c.s, l };
    if (contrast(bg, dark) >= 4.5) return { bg, fg: trip(dark) };
  }
  return { bg: { h: c.h, s: c.s, l: 96 }, fg: trip(dark) };
}

/** Scurisce `fg` finché ha contrasto >=4.5 sul fondo `bg` (per testo su accent). */
function ensureReadableOn(fg: Hsl, bg: Hsl): Hsl {
  const out = { ...fg };
  for (let l = fg.l; l >= 10; l -= 1) {
    out.l = l;
    if (contrast(out, bg) >= 4.5) return out;
  }
  return out;
}

/** HSL (h 0-360, s/l 0-100) → RGB 0-1. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sN = s / 100;
  const lN = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/** Converte #RGB/#RRGGBB in HSL (h 0-360, s/l 0-100). null se non valido. */
function hexToHsl(hex: string): Hsl | null {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let hue = 0;
  let sat = 0;
  const d = max - min;
  if (d !== 0) {
    sat = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        hue = ((g - b) / d) % 6;
        break;
      case g:
        hue = (b - r) / d + 2;
        break;
      default:
        hue = (r - g) / d + 4;
    }
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { h: hue, s: sat * 100, l: l * 100 };
}
