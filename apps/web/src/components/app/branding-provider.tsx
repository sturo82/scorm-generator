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
  // Foreground che contrasta col primario.
  const fg = c.l > 68 ? trip(c.h, 30, 12) : '0 0% 100%';
  // Accent: dal campo dedicato oppure derivato dal primario (tinta chiara).
  const a = acc ?? { h: c.h, s: Math.min(c.s, 70), l: 55 };
  // Header: dal campo dedicato oppure dal primario.
  const hd = hdr ?? c;
  // Foreground dell'header: bianco su header scuri, scuro su header chiari.
  const hfg = hd.l > 68 ? trip(hd.h, 30, 12) : '0 0% 100%';
  return {
    '--primary': trip(c.h, c.s, c.l),
    '--primary-foreground': fg,
    '--ring': trip(c.h, c.s, c.l),
    // Accent tenue (sfondo di stati hover/selezione): molto chiaro dal colore accent.
    '--accent': trip(a.h, Math.min(a.s, 70), 94),
    '--accent-foreground': trip(a.h, Math.min(a.s + 10, 90), Math.max(a.l - 18, 24)),
    '--sidebar-accent': trip(a.h, Math.min(a.s, 70), 92),
    // Gradiente di sfondo app: velo diffuso della tinta primaria.
    '--app-gradient-a': trip(c.h, Math.min(c.s, 72), 94),
    '--app-gradient-b': trip(c.h, 24, 98),
    // Gradiente dell'header: dal colore header a una variante più profonda.
    '--header-gradient-a': trip(hd.h, hd.s, Math.max(hd.l - 4, 18)),
    '--header-gradient-b': trip(hd.h + 12, Math.min(hd.s + 6, 92), Math.max(hd.l - 16, 12)),
    '--header-foreground': hfg,
    // Alone/glow colorato per bagliori ed evidenziazioni.
    '--brand-glow': trip(c.h, c.s, c.l),
    // Ombra colorata (brand) per profondità premium.
    '--shadow-color': trip(hd.h, Math.min(hd.s + 10, 90), Math.max(hd.l - 26, 10)),
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, n)));
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
