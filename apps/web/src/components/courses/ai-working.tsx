'use client';

import { Loader2, Sparkles } from 'lucide-react';

/**
 * Indicatore riusabile "AI al lavoro": comunica che una generazione è in corso
 * e che il sistema non è bloccato. Usato per outline, contenuti, immagini,
 * narrazione e copertina. Rispetta prefers-reduced-motion (lo spin viene
 * neutralizzato via la utility motion-reduce di Tailwind).
 */
export function AiWorking({
  label = 'L’AI sta lavorando…',
  hint,
  className,
}: {
  label?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border border-primary/30 bg-accent/40 px-4 py-3 ${className ?? ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-primary/10">
        <Sparkles className="size-4 text-primary" />
        <Loader2 className="absolute size-9 animate-spin text-primary/50 motion-reduce:animate-none" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </div>
  );
}

/**
 * Variante compatta inline (per i bottoni/righe di lezione): solo spinner +
 * testo breve.
 */
export function AiWorkingInline({ label = 'Generazione…' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground" role="status" aria-live="polite">
      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
      {label}
    </span>
  );
}
