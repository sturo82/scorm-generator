'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Badge "In generazione": pillola premium con spinner e alone pulsante.
 * Indica che un corso ha una generazione AI in corso. Usato nella lista corsi
 * e nell'header del corso. Alimentato dall'endpoint tenant-wide /jobs/active.
 */
export function GeneratingBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary shadow-card',
        className,
      )}
      role="status"
      aria-label="Generazione in corso"
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
        <span className="relative inline-flex size-2 rounded-full bg-primary" />
      </span>
      <Loader2 className="size-3 animate-spin" />
      In generazione
    </span>
  );
}
