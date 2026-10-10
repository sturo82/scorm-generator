'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';
import { useBranding } from '@/lib/api/hooks';

interface AppBrandProps {
  /** Nasconde testo/tagline (solo marchio), es. header mobile compatto. */
  iconOnly?: boolean;
  className?: string;
  /** Altezza del marchio in px (il wordmark scala in larghezza). */
  size?: number;
  /**
   * Mostra l'etichetta d'ecosistema "by Knowkube" sotto il marchio. Di default
   * true nei contesti ampi (sidebar/drawer). È SEMPRE Knowkube, indipendente dal
   * white-label del tenant: così l'appartenenza all'ecosistema resta evidente.
   */
  showEcosystem?: boolean;
}

/**
 * Marchio dell'app guidato dal branding del tenant, con l'identità d'ecosistema
 * Knowkube sempre presente.
 *
 * - Tenant con logo caricato → logo del tenant + nome (white-label rispettato).
 * - Default di prodotto → wordmark "K. Scorm" (immagine che include già il nome).
 * - "by Knowkube" → tagline persistente, non white-label, per mantenere evidente
 *   l'ecosistema anche quando un tenant applica i propri colori/logo.
 */
export function AppBrand({
  iconOnly = false,
  className,
  size = 32,
  showEcosystem = true,
}: AppBrandProps) {
  const { data } = useBranding();
  const appName = data?.appName || 'K Scorm';
  const logoUrl = data?.logoUrl ?? null;

  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      {logoUrl ? (
        // Tenant white-label: logo caricato + nome testuale.
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl}
            alt={appName}
            style={{ width: size, height: size }}
            className="shrink-0 rounded-lg object-contain"
          />
          {!iconOnly && (
            <span className="flex flex-col leading-tight">
              <span className="truncate font-semibold tracking-tight">{appName}</span>
              {showEcosystem && (
                <span className="text-[10px] font-medium uppercase tracking-widest opacity-70">
                  by Knowkube
                </span>
              )}
            </span>
          )}
        </>
      ) : iconOnly ? (
        // Compatto (mobile): solo l'icona di prodotto.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/brand/kscorm-icon-white.png"
          alt={appName}
          style={{ width: size, height: size }}
          className="shrink-0 rounded-lg object-contain"
        />
      ) : (
        // Default di prodotto: wordmark K Scorm (già comprensivo del nome) +
        // tagline d'ecosistema persistente.
        <span className="flex flex-col gap-0.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/kscorm-wordmark-white-trim.png"
            alt={appName}
            style={{ height: Math.round(size * 0.62) }}
            className="w-auto object-contain"
          />
          {showEcosystem && (
            <span className="pl-0.5 text-[10px] font-medium uppercase tracking-widest opacity-70">
              by Knowkube
            </span>
          )}
        </span>
      )}
    </span>
  );
}
