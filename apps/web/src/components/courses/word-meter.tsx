'use client';

import { videoScriptFit, VIDEO_SCRIPT } from '@scorm/contracts';
import { cn } from '@/lib/cn';

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/**
 * Taratura del copione sulla durata del video: barra che si riempie con le parole, verde quando
 * voce e video finiscono insieme, gialla se il copione è troppo corto, rossa se è troppo lungo.
 */
export function WordMeter({
  text,
  durationSec,
  wordsPerSec = VIDEO_SCRIPT.wordsPerSec,
  className,
}: {
  text: string;
  durationSec: number;
  wordsPerSec?: number;
  className?: string;
}) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const fit = videoScriptFit(words, durationSec, wordsPerSec);
  const pct = Math.min(100, Math.round((words / Math.max(1, fit.budget.max)) * 100));
  const minPct = Math.round((fit.budget.min / Math.max(1, fit.budget.max)) * 100);
  const tone =
    fit.status === 'ok' ? 'bg-emerald-500' : fit.status === 'long' ? 'bg-red-500' : fit.status === 'short' ? 'bg-amber-400' : 'bg-muted-foreground/30';
  const label =
    fit.status === 'ok'
      ? 'Tarato sulla durata'
      : fit.status === 'long'
        ? `Troppo lungo: togli circa ${words - fit.budget.max} parole`
        : fit.status === 'short'
          ? `Corto: aggiungi circa ${fit.budget.min - words} parole`
          : `Scrivi circa ${fit.budget.target} parole`;
  return (
    <div className={cn('space-y-1', className)} aria-live="polite">
      <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
        <span aria-hidden className="absolute inset-y-0 w-px bg-foreground/30" style={{ left: `${minPct}%` }} />
        <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 text-[11px]">
        <span className={cn('font-medium', fit.status === 'long' ? 'text-red-700' : fit.status === 'short' ? 'text-amber-700' : fit.status === 'ok' ? 'text-emerald-700' : 'text-muted-foreground')}>
          {label}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {words} parole · voce circa {fmt(fit.estSec)} su {fmt(durationSec)} di video
        </span>
      </div>
    </div>
  );
}
