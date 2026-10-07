'use client';

import * as React from 'react';
import { Sparkles } from 'lucide-react';
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
 * Se è presente un logo caricato lo mostra; altrimenti usa l'icona di default.
 * Il nome dell'app usa `appName` del branding, con fallback a "SCORM Generator".
 */
export function AppBrand({ iconOnly = false, className, size = 32 }: AppBrandProps) {
  const { data } = useBranding();
  const appName = data?.appName || 'SCORM Generator';
  const logoUrl = data?.logoUrl ?? null;

  return (
    <span className={cn('flex items-center gap-2.5 font-semibold tracking-tight', className)}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={appName}
          style={{ width: size, height: size }}
          className="shrink-0 rounded-lg object-contain"
        />
      ) : (
        <span
          style={{ width: size, height: size }}
          className="brand-glow grid shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground"
        >
          <Sparkles className="size-4" />
        </span>
      )}
      {!iconOnly && <span className="truncate">{appName}</span>}
    </span>
  );
}
