'use client';
import * as React from 'react';
import { AlertTriangle, Check, Circle, Loader2, PartyPopper, XCircle } from 'lucide-react';
import type { AutopilotView } from '@scorm/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { CourseBudget } from '@/components/app/course-budget';
import { CourseBuilder } from '@/components/courses/course-builder';
import { cn } from '@/lib/cn';
import { useAutopilotActions } from '@/lib/api/hooks';

type StepState = 'done' | 'active' | 'todo' | 'skipped';

/** Ordine delle fasi per sapere cosa è già fatto. */
const ORDER = ['structure', 'review', 'content', 'tests', 'cover', 'extras', 'done'] as const;

function stepState(view: AutopilotView, phase: (typeof ORDER)[number]): StepState {
  const cur = ORDER.indexOf(view.phase);
  const me = ORDER.indexOf(phase);
  if (view.status === 'completed' || me < cur) return 'done';
  if (me === cur) return view.status === 'running' || view.status === 'paused' ? 'active' : 'todo';
  return 'todo';
}

function StepRow({ state, title, detail }: { state: StepState; title: string; detail?: string }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={cn(
          'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full',
          state === 'done' && 'bg-emerald-100 text-emerald-700',
          state === 'active' && 'bg-primary/10 text-primary',
          state === 'todo' && 'bg-muted text-muted-foreground',
        )}
      >
        {state === 'done' ? <Check className="size-4" /> : state === 'active' ? <Loader2 className="size-4 animate-spin" /> : <Circle className="size-3" />}
      </span>
      <div className="min-w-0">
        <p className={cn('text-sm font-medium', state === 'todo' && 'text-muted-foreground')}>{title}</p>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </div>
    </li>
  );
}

/**
 * Schermata della generazione automatica: una sola vista con le fasi e l'avanzamento, al posto dei
 * passi guidati. In pausa per la revisione mostra la struttura; alla fine un riepilogo.
 */
export function AutopilotScreen({ courseId, view }: { courseId: string; view: AutopilotView }) {
  const toast = useToast();
  const actions = useAutopilotActions(courseId);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const p = view.progress;
  const o = view.options;
  const extras = [o.moduleCovers && 'copertine dei moduli', o.narration && 'voce narrante', o.lessonVideos && 'video delle pillole'].filter(Boolean);
  const videoDetail =
    p.videos.done + p.videos.processing + p.videos.pending > 0
      ? `Video: ${p.videos.done} pronti${p.videos.processing ? `, ${p.videos.processing} in lavorazione` : ''}${p.videos.pending ? `, ${p.videos.pending} da avviare` : ''}`
      : undefined;

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast.show(ok, 'success');
    } catch (err) {
      toast.show(err instanceof Error ? err.message.replace(/^API \d+:\s*/, '') : 'Operazione non riuscita', 'error');
    }
  };

  const finished = view.status === 'completed' || view.status === 'failed' || view.status === 'cancelled';

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-5 p-6">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                {view.status === 'completed' ? (
                  <>
                    <PartyPopper className="size-5 text-primary" /> Il corso è pronto
                  </>
                ) : view.status === 'paused' ? (
                  'Struttura pronta: rivedila'
                ) : view.status === 'failed' ? (
                  <>
                    <XCircle className="size-5 text-destructive" /> Generazione interrotta
                  </>
                ) : view.status === 'cancelled' ? (
                  'Generazione annullata'
                ) : (
                  'Sto creando il tuo corso…'
                )}
              </h2>
              <p className="text-sm text-muted-foreground">
                {view.status === 'running'
                  ? 'Lavora sul server: puoi chiudere la pagina e tornare quando vuoi.'
                  : view.status === 'paused'
                    ? 'Controlla moduli e lezioni qui sotto (puoi modificarli), poi continua con i contenuti.'
                    : view.status === 'completed'
                      ? 'Contenuti, test e copertina sono pronti. Ora puoi rivederlo e modificarlo.'
                      : view.status === 'cancelled'
                        ? 'Hai fermato la generazione: paghi solo quello che è stato già generato.'
                        : (view.error ?? 'Si è verificato un errore.')}
              </p>
            </div>
            <CourseBudget courseId={courseId} />
          </header>

          <ol className="space-y-3">
            <StepRow state={stepState(view, 'structure')} title="Struttura del corso" detail={p.lessons.total ? `${p.lessons.total} lezioni` : undefined} />
            {view.reviewStructure && <StepRow state={stepState(view, 'review')} title="Tua revisione della struttura" />}
            <StepRow
              state={stepState(view, 'content')}
              title="Contenuti delle lezioni e immagini"
              detail={p.lessons.total ? `${p.lessons.done} di ${p.lessons.total} lezioni pronte` : undefined}
            />
            <StepRow state={stepState(view, 'tests')} title="Test" detail={p.tests.total ? `${p.tests.done} di ${p.tests.total}` : 'Nessun test richiesto'} />
            <StepRow state={stepState(view, 'cover')} title="Copertina" detail={p.cover ? 'Pronta' : undefined} />
            {extras.length > 0 && (
              <StepRow
                state={stepState(view, 'extras')}
                title={`Da aggiungere: ${extras.join(', ')}`}
                detail={[videoDetail, o.narration ? `Voce narrante: ${p.narration.done} di ${p.narration.total}` : undefined].filter(Boolean).join(' · ') || undefined}
              />
            )}
          </ol>

          {view.status === 'completed' && p.videos.processing > 0 && (
            <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              I video delle pillole sono ancora in lavorazione: compaiono nelle lezioni appena pronti. Intanto puoi già rivedere il corso.
            </p>
          )}

          {view.issues.length > 0 && (
            <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="mb-1 flex items-center gap-2 font-medium">
                <AlertTriangle className="size-4" /> Da completare
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-xs">
                {view.issues.map((i, n) => (
                  <li key={n}>{i}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs">Non ti è stato addebitato nulla per ciò che non è stato generato.</p>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {(view.status === 'running' || view.status === 'paused') && (
              <Button variant="outline" onClick={() => setConfirmCancel(true)} disabled={actions.cancel.isPending}>
                Annulla generazione
              </Button>
            )}
            {view.status === 'paused' && (
              <Button onClick={() => void run(() => actions.resume.mutateAsync(), 'Generazione ripresa')} disabled={actions.resume.isPending}>
                Continua con i contenuti
              </Button>
            )}
            {(view.status === 'failed' || view.status === 'cancelled') && (
              <Button
                variant="outline"
                onClick={() => void run(() => actions.start.mutateAsync({ reviewStructure: false, options: view.options }), 'Generazione ripresa')}
                disabled={actions.start.isPending}
              >
                Riprendi la generazione
              </Button>
            )}
            {finished && (
              <Button onClick={() => void run(() => actions.dismiss.mutateAsync())} disabled={actions.dismiss.isPending}>
                {view.status === 'completed' ? 'Rivedi il corso' : 'Continua a mano'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {view.status === 'paused' && <CourseBuilder courseId={courseId} mode="structure" />}

      <ConfirmDialog
        open={confirmCancel}
        title="Annullare la generazione?"
        message="Si ferma dopo il pezzo in lavorazione. Paghi solo quello che è già stato generato; potrai riprendere quando vuoi."
        confirmLabel="Annulla generazione"
        cancelLabel="Continua"
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false);
          void run(() => actions.cancel.mutateAsync(), 'Generazione annullata');
        }}
      />
    </div>
  );
}
