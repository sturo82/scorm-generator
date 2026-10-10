'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';
import { useBranding } from '@/lib/api/hooks';

interface AppBrandProps {
  /** Nasconde il testo (solo marchio), es. header mobile compatto. */
  iconOnly?: boolean;
  className?: string;
  /** Dimensione del riquadro del marchio (px lato). */
  size?: number;
}

/**
 * Marchio dell'app (logo + nome) guidato dal branding white-label del tenant.
 * Se è presente un logo caricato lo mostra; altrimenti usa il marchio di default
 * del prodotto K Scorm (ecosistema Knowkube). Il nome usa `appName` del branding,
 * con fallback a "K Scorm". L'icona di default è la versione bianca, pensata per
 * stare sull'area logo scura (gradiente di piattaforma) di header e sidebar.
 */
export function AppBrand({ iconOnly = false, className, size = 32 }: AppBrandProps) {
  const { data } = useBranding();
  const appName = data?.appName || 'K Scorm';
  const logoUrl = data?.logoUrl ?? null;

  return (
    <span className={cn('flex items-center gap-2.5 font-semibold tracking-tight', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl ?? '/brand/kscorm-icon-white.png'}
        alt={appName}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-lg object-contain"
      />
      {!iconOnly && <span className="truncate">{appName}</span>}
    </span>
  );
}
