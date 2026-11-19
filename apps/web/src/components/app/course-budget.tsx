'use client';
import { Coins } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useExistingCourseEstimate } from '@/lib/api/hooks';

const fmt = (n: number) => n.toLocaleString('it-IT');

/** "Speso X di Y crediti" del corso: crediti impegnati rispetto al preventivo confermato. */
export function CourseBudget({ courseId, className }: { courseId: string; className?: string }) {
  const q = useExistingCourseEstimate(courseId);
  const e = q.data;
  if (!e?.billed || !e.budget || e.budget.credits === null) return null;
  const { credits, committed } = e.budget;
  const pct = credits > 0 ? Math.min(100, Math.round((committed / credits) * 100)) : 100;
  return (
    <div className={cn('flex items-center gap-3 text-xs text-muted-foreground', className)} title="Crediti spesi o in uso rispetto al preventivo confermato del corso">
      <Coins className="size-4 shrink-0 text-primary" aria-hidden />
      <span>
        Speso <strong className="text-foreground">{fmt(committed)}</strong> di {fmt(credits)} crediti del preventivo
      </span>
      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={cn('block h-full rounded-full', pct >= 100 ? 'bg-amber-500' : 'bg-primary')} style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}
