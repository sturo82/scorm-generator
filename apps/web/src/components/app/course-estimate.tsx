'use client';
import * as React from 'react';
import { AlertTriangle, Coins, ShieldCheck } from 'lucide-react';
import { LESSON_IMAGE_CAP, type CourseEstimateInput, type CourseEstimateView } from '@scorm/contracts';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { useCourseEstimate, useExistingCourseEstimate } from '@/lib/api/hooks';

const FORMAT_LABEL: Record<string, string> = {
  standard: 'standard',
  pillola: 'pillola',
  pillola_interattiva: 'pillola interattiva',
  video_first: 'video-first',
};

const fmt = (n: number) => n.toLocaleString('it-IT');

function lineLabel(l: CourseEstimateView['lines'][number], mode: CourseEstimateView['mode']): string {
  switch (l.kind) {
    case 'structure':
      return 'Struttura del corso';
    case 'lessons': {
      const f = FORMAT_LABEL[l.format ?? 'standard'] ?? l.format;
      const cap = LESSON_IMAGE_CAP[(l.format ?? 'standard') as keyof typeof LESSON_IMAGE_CAP];
      const what = `${l.quantity} ${l.quantity === 1 ? 'lezione' : 'lezioni'} ${f}`;
      return mode === 'package' && cap ? `${what} (immagini incluse, fino a ${cap} per lezione)` : what;
    }
    case 'images':
      return `Immagini delle lezioni (fino a ${l.quantity})`;
    case 'tests':
      return `${l.quantity} ${l.quantity === 1 ? 'test' : 'test'} (intermedi e/o finale)`;
    case 'cover':
      return 'Copertina';
  }
}

/**
 * Preventivo in crediti del corso: è il massimo che verrà addebitato (lezioni, moduli, immagini e
 * tentativi sono limitati), con il confronto con il saldo. Non compare se i crediti non sono attivi.
 */
export function CourseEstimate(
  props: ({ input: Partial<CourseEstimateInput> | null; courseId?: never } | { courseId: string; input?: never }) & {
    title?: string;
    note?: string;
    className?: string;
  },
) {
  const fromInput = useCourseEstimate(props.courseId ? null : (props.input ?? null));
  const fromCourse = useExistingCourseEstimate(props.courseId ?? '');
  const q = props.courseId ? fromCourse : fromInput;
  if (q.fetchStatus === 'idle' && !q.data) return null;
  if (q.isLoading) return <Skeleton className={cn('h-24 w-full', props.className)} />;
  const e = q.data;
  if (!e || !e.billed || e.lines.length === 0) return null;
  const short = e.available !== undefined && e.available < e.total;
  return (
    <div className={cn('rounded-lg border bg-card p-4 text-sm', props.className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-medium">
          <Coins className="size-4 text-primary" aria-hidden /> {props.title ?? 'Preventivo del corso'}
        </p>
        <p className="text-right">
          <span className="text-lg font-bold">{e.priced ? fmt(e.total) : '—'}</span>{' '}
          <span className="text-xs text-muted-foreground">crediti al massimo</span>
        </p>
      </div>
      <ul className="space-y-1">
        {e.lines.map((l, i) => (
          <li key={`${l.kind}-${l.format ?? ''}-${i}`} className="flex justify-between gap-3 text-muted-foreground">
            <span>{lineLabel(l, e.mode)}</span>
            <span className="font-mono text-foreground">{l.credits === null ? 'non disponibile' : fmt(l.credits)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden />
        <span>
          Non ti addebiteremo di più: è il massimo. Paghi solo quello che viene generato.
          {e.aiChosenFormats > 0 && ' Le lezioni con formato scelto dall\u2019AI sono calcolate come standard (il formato più caro).'}
          {props.note ? ` ${props.note}` : ''}
        </span>
      </p>
      {!e.priced && (
        <p className="mt-2 text-xs text-destructive">Alcune voci non hanno ancora un prezzo: per ora non si possono generare.</p>
      )}
      {short && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Hai {fmt(e.available ?? 0)} crediti disponibili: potrebbero non bastare per completare il corso.{' '}
          <a className="underline" href="/wallet">
            Ricarica
          </a>
        </p>
      )}
    </div>
  );
}
