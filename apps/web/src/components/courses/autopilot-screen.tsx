'use client';
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, Check, Circle, ImageIcon, ListChecks, Loader2, PartyPopper, Sparkles, Video, Volume2, XCircle } from 'lucide-react';
import type { AutopilotView } from '@scorm/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { SlideVideoDialog } from '@/components/courses/slide-video-dialog';
import { wizardLandingKey } from '@/lib/wizard-landing';
import { CourseBudget } from '@/components/app/course-budget';
import { CourseBuilder } from '@/components/courses/course-builder';
import { cn } from '@/lib/cn';
import { useAutopilotActions } from '@/lib/api/hooks';

type StepState = 'done' | 'active' | 'todo';

/** Ordine delle fasi per sapere cosa è già fatto. */
const ORDER = ['structure', 'review', 'content', 'tests', 'cover', 'extras', 'scripts', 'scripts_review', 'clips', 'lesson', 'done'] as const;

function stepState(view: AutopilotView, phase: (typeof ORDER)[number]): StepState {
  const cur = ORDER.indexOf(view.phase);
  const me = ORDER.indexOf(phase);
  if (view.status === 'completed' || me < cur) return 'done';
  if (me === cur) return view.status === 'running' || view.status === 'paused' ? 'active' : 'todo';
  return 'todo';
}

/** Frasi che ruotano sotto il titolo, in base alla fase: danno il senso di cosa sta succedendo. */
const PHASE_LINES: Record<string, string[]> = {
  structure: ['Disegno moduli e lezioni…', 'Costruisco la progressione didattica…', 'Allineo la struttura al tuo brief…'],
  review: ['Struttura pronta per la tua revisione'],
  content: ['Scrivo i contenuti delle lezioni…', 'Scelgo le immagini che aiutano a capire…', 'Preparo esercizi e verifiche…', 'Curo il tono di voce del brand…'],
  tests: ['Preparo domande e feedback…', 'Calibro la difficoltà dei test…'],
  cover: ['Disegno la copertina del corso…'],
  extras: ['Aggiungo video, voce e copertine…', 'Rifinisco i dettagli…'],
  scripts: ['Leggo le slide una per una…', 'Scrivo il copione che l\u2019avatar pronuncerà…', 'Controllo tono e pronuncia…'],
  scripts_review: ['Copioni pronti per la tua revisione'],
  clips: ['L\u2019avatar sta registrando le clip…', 'Sincronizzo voce e labiale…', 'Scarico e controllo ogni clip…'],
  lesson: ['Monto slide e avatar in un unico video…', 'Preparo riepilogo e quiz…', 'Creo la lezione nel corso…'],
  done: ['Tutto pronto'],
};

/** Testo che cambia con una dissolvenza ogni pochi secondi. */
function RotatingLine({ lines }: { lines: string[] }) {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    setI(0);
    if (lines.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % lines.length), 3500);
    return () => clearInterval(t);
  }, [lines]);
  return (
    <p key={`${lines[0]}-${i}`} className="text-sm text-muted-foreground motion-safe:animate-fade-in">
      {lines[i % lines.length]}
    </p>
  );
}

/** Anello con la percentuale complessiva, con un pennello di luce che lo percorre mentre lavora. */
function ProgressRing({ pct, active, done }: { pct: number; active: boolean; done: boolean }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className={cn('relative grid size-20 shrink-0 place-items-center', active && 'motion-safe:animate-orb-float')}>
      <svg viewBox="0 0 80 80" className="size-20 -rotate-90">
        <circle cx="40" cy="40" r={r} className="fill-none stroke-muted" strokeWidth="6" />
        <circle
          cx="40"
          cy="40"
          r={r}
          className={cn('fill-none transition-[stroke-dashoffset] duration-700 ease-out', done ? 'stroke-emerald-500' : 'stroke-primary')}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
        />
      </svg>
      <span className="absolute text-sm font-semibold tabular-nums">{done ? <Check className="size-6 text-emerald-600" /> : `${pct}%`}</span>
      {active && <span aria-hidden className="absolute inset-1 rounded-full motion-safe:animate-ring-pulse" />}
    </div>
  );
}

/** Barra con un riflesso che scorre finché il lavoro è in corso. */
function ShimmerBar({ pct, active }: { pct: number; active: boolean }) {
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
      {active && <span aria-hidden className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent motion-safe:animate-shimmer" />}
    </div>
  );
}

function StepRow({ state, icon, title, detail, pct }: { state: StepState; icon: React.ReactNode; title: string; detail?: string; pct?: number }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={cn(
          'relative mt-0.5 grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-500',
          state === 'done' && 'bg-emerald-100 text-emerald-700',
          state === 'active' && 'bg-primary/10 text-primary',
          state === 'todo' && 'bg-muted text-muted-foreground',
        )}
      >
        {state === 'done' ? (
          <Check key="ok" className="size-4 motion-safe:animate-pop-in" />
        ) : state === 'active' ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            <span aria-hidden className="absolute inset-0 rounded-full motion-safe:animate-ring-pulse" />
          </>
        ) : (
          icon
        )}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className={cn('text-sm font-medium transition-colors', state === 'todo' && 'text-muted-foreground')}>{title}</p>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
        {state === 'active' && pct !== undefined && <ShimmerBar pct={pct} active />}
      </div>
    </li>
  );
}

/** Le lezioni come tessere in fila: si accendono man mano che sono pronte. */
function LessonTiles({ items, active }: { items: AutopilotView['progress']['lessonItems']; active: boolean }) {
  if (items.length === 0) return null;
  const firstPending = items.findIndex((l) => !l.done);
  return (
    <ul className="grid gap-2 sm:grid-cols-2" aria-label="Lezioni del corso">
      {items.map((l, i) => {
        const building = active && i === firstPending;
        return (
          <li
            key={`${i}-${l.title}`}
            className={cn(
              'relative flex items-center gap-2 overflow-hidden rounded-lg border px-3 py-2 text-xs transition-all duration-500',
              l.done ? 'border-emerald-300/60 bg-emerald-50 text-emerald-900' : building ? 'border-primary/40 bg-primary/5' : 'bg-muted/30 text-muted-foreground',
            )}
          >
            {l.done ? (
              <Check key="ok" className="size-3.5 shrink-0 motion-safe:animate-pop-in" />
            ) : building ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
            ) : (
              <Circle className="size-3 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">{l.title}</span>
            {building && <span aria-hidden className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-primary/10 to-transparent motion-safe:animate-shimmer" />}
          </li>
        );
      })}
    </ul>
  );
}

/** Coriandoli alla fine: pochi, brevi, nei colori del brand. */
function Confetti() {
  const pieces = React.useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        left: 8 + ((i * 41) % 84),
        dx: ((i * 29) % 90) - 45,
        rot: 120 + ((i * 53) % 480),
        delay: (i % 7) * 0.06,
        color: ['bg-primary', 'bg-emerald-400', 'bg-amber-400', 'bg-sky-400'][i % 4],
      })),
    [],
  );
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 hidden h-0 motion-safe:block">
      {pieces.map((p, i) => (
        <span
          key={i}
          className={cn('absolute top-2 block h-2 w-1.5 rounded-sm motion-safe:animate-confetti', p.color)}
          style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, ['--dx' as string]: `${p.dx}px`, ['--rot' as string]: `${p.rot}deg` }}
        />
      ))}
    </div>
  );
}

/**
 * Schermata della generazione automatica: una sola vista con le fasi e l'avanzamento, al posto dei
 * passi guidati. In pausa per la revisione mostra la struttura; alla fine un riepilogo. Le
 * animazioni sono dietro `motion-safe`: con "riduci animazioni" restano solo i cambi di stato.
 */
export function AutopilotScreen({ courseId, view }: { courseId: string; view: AutopilotView }) {
  const toast = useToast();
  const qc = useQueryClient();
  const actions = useAutopilotActions(courseId);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const p = view.progress;
  const o = view.options;
  const running = view.status === 'running';
  const finished = view.status === 'completed' || view.status === 'failed' || view.status === 'cancelled';
  const slidesMode = view.kind === 'slides' && Boolean(view.slides);
  const sv = view.slides;
  const [reviewOpen, setReviewOpen] = React.useState(false);

  // Il saldo nell'intestazione segue l'avanzamento: a ogni passo completato si rilegge il wallet.
  const tick = `${p.lessons.done}-${p.tests.done}-${p.cover}-${p.videos.done}-${p.narration.done}-${view.status}-${sv?.clips.done ?? 0}-${sv?.lesson ?? ''}-${sv?.scripts ?? ''}`;
  React.useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['billing', 'wallet'] });
    void qc.invalidateQueries({ queryKey: ['billing', 'estimate', 'course', courseId] });
  }, [tick, qc, courseId]);

  // Percentuale complessiva: peso di struttura, lezioni, test, copertina e componenti aggiuntive.
  const extrasTotal = (o.narration ? p.narration.total : 0) + p.videos.done + p.videos.processing + p.videos.pending;
  const extrasDone = (o.narration ? p.narration.done : 0) + p.videos.done;
  const parts = [
    { w: 1, v: p.lessons.total > 0 ? 1 : view.phase === 'structure' ? 0 : 1 },
    { w: 6, v: p.lessons.total ? p.lessons.done / p.lessons.total : 0 },
    { w: 2, v: p.tests.total ? p.tests.done / p.tests.total : 1 },
    { w: 1, v: p.cover ? 1 : 0 },
    { w: extrasTotal > 0 ? 2 : 0, v: extrasTotal ? extrasDone / extrasTotal : 0 },
  ];
  const slideParts = sv
    ? [
        { w: 2, v: sv.scripts === 'approved' || sv.scripts === 'draft' ? 1 : 0 },
        { w: 6, v: sv.clips.total ? sv.clips.done / sv.clips.total : 0 },
        { w: 3, v: sv.lesson === 'completed' ? 1 : sv.lesson === 'running' ? 0.4 : 0 },
      ]
    : [];
  const allParts = slidesMode ? slideParts : parts;
  const totalW = allParts.reduce((n, x) => n + x.w, 0);
  const pct = view.status === 'completed' ? 100 : Math.min(99, Math.round((allParts.reduce((n, x) => n + x.w * x.v, 0) / totalW) * 100));

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

  return (
    <div className="space-y-6">
      <Card className="relative overflow-hidden">
        {/* Aurora: un gradiente dei colori del brand che si sposta lentamente, solo mentre lavora. */}
        {running && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.14] [background-size:300%_300%] bg-gradient-to-br from-primary via-emerald-300 to-sky-300 motion-safe:animate-aurora"
          />
        )}
        {view.status === 'completed' && <Confetti />}
        <CardContent className="relative space-y-6 p-6">
          <header className="flex flex-wrap items-start gap-4">
            <ProgressRing pct={pct} active={running} done={view.status === 'completed'} />
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                {view.status === 'completed' ? (
                  <>
                    <PartyPopper className="size-5 text-primary motion-safe:animate-pop-in" /> Il corso è pronto
                  </>
                ) : view.status === 'paused' ? (
                  slidesMode ? 'Copioni pronti: rivedili' : 'Struttura pronta: rivedila'
                ) : view.status === 'failed' ? (
                  <>
                    <XCircle className="size-5 text-destructive" /> Generazione interrotta
                  </>
                ) : view.status === 'cancelled' ? (
                  'Generazione annullata'
                ) : (
                  <>
                    {slidesMode ? 'Sto creando la tua video-lezione' : 'Sto creando il tuo corso'} <Sparkles className="size-4 text-primary motion-safe:animate-spin-slow" />
                  </>
                )}
              </h2>
              {running ? (
                <RotatingLine lines={PHASE_LINES[view.phase] ?? PHASE_LINES.content!} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {view.status === 'paused'
                    ? slidesMode
                      ? (sv?.reviewReason ?? 'Leggi e correggi i copioni: da qui partono le clip con l\u2019avatar, la parte che costa di più.')
                      : 'Controlla moduli e lezioni qui sotto (puoi modificarli), poi continua con i contenuti.'
                    : view.status === 'completed'
                      ? slidesMode
                        ? 'La video-lezione è pronta, con riepilogo e quiz. Ora puoi rivederla nell\u2019anteprima e modificarla.'
                        : 'Contenuti, test e copertina sono pronti. Ora puoi rivederlo e modificarlo.'
                      : view.status === 'cancelled'
                        ? 'Hai fermato la generazione: paghi solo quello che è stato già generato.'
                        : view.errorCode === 'insufficient_credits'
                          ? 'I crediti sono finiti a metà: ricarica e riprendi, si riparte da dove si era fermata (quello già fatto non si paga di nuovo).'
                          : (view.error ?? 'Si è verificato un errore.')}
                </p>
              )}
              {running && <p className="mt-1 text-xs text-muted-foreground/80">Lavora sul server: puoi chiudere la pagina e tornare quando vuoi.</p>}
            </div>
            <CourseBudget courseId={courseId} />
          </header>

          {slidesMode && sv ? (
            <ol className="space-y-4">
              <StepRow
                state={stepState(view, 'scripts')}
                icon={<BookOpen className="size-4" />}
                title="Copioni delle slide"
                detail={sv.slides ? `${sv.slides} slide` : undefined}
              />
              {sv.reviewScripts || sv.reviewReason ? (
                <StepRow state={stepState(view, 'scripts_review')} icon={<Check className="size-4" />} title="Tua revisione dei copioni" />
              ) : null}
              <StepRow
                state={stepState(view, 'clips')}
                icon={<Video className="size-4" />}
                title="Clip con l’avatar"
                detail={sv.clips.total ? `${sv.clips.done} di ${sv.clips.total} clip pronte${sv.clips.failed ? `, ${sv.clips.failed} da rifare` : ''}` : undefined}
                pct={sv.clips.total ? Math.round((sv.clips.done / sv.clips.total) * 100) : 0}
              />
              {stepState(view, 'clips') !== 'todo' && sv.clips.total > 0 && (
                <LessonTiles
                  items={Array.from({ length: sv.clips.total }, (_, i) => ({ title: `Slide ${i + 1}`, format: 'standard', done: i < sv.clips.done }))}
                  active={running && view.phase === 'clips'}
                />
              )}
              <StepRow
                state={stepState(view, 'lesson')}
                icon={<ListChecks className="size-4" />}
                title="Montaggio, riepilogo e quiz"
                detail={sv.lesson === 'completed' ? 'Lezione creata' : undefined}
              />
            </ol>
          ) : (
            <ol className="space-y-4">
            <StepRow
              state={stepState(view, 'structure')}
              icon={<BookOpen className="size-4" />}
              title="Struttura del corso"
              detail={p.lessons.total ? `${p.lessons.total} lezioni` : undefined}
            />
            {view.reviewStructure && <StepRow state={stepState(view, 'review')} icon={<Check className="size-4" />} title="Tua revisione della struttura" />}
            <StepRow
              state={stepState(view, 'content')}
              icon={<ImageIcon className="size-4" />}
              title="Contenuti delle lezioni e immagini"
              detail={p.lessons.total ? `${p.lessons.done} di ${p.lessons.total} lezioni pronte` : undefined}
              pct={p.lessons.total ? Math.round((p.lessons.done / p.lessons.total) * 100) : 0}
            />
            {stepState(view, 'content') !== 'todo' && <LessonTiles items={p.lessonItems} active={running && view.phase === 'content'} />}
            <StepRow
              state={stepState(view, 'tests')}
              icon={<ListChecks className="size-4" />}
              title="Test"
              detail={p.tests.total ? `${p.tests.done} di ${p.tests.total}` : 'Nessun test richiesto'}
              pct={p.tests.total ? Math.round((p.tests.done / p.tests.total) * 100) : 0}
            />
            <StepRow state={stepState(view, 'cover')} icon={<ImageIcon className="size-4" />} title="Copertina" detail={p.cover ? 'Pronta' : undefined} />
            {extras.length > 0 && (
              <StepRow
                state={stepState(view, 'extras')}
                icon={o.lessonVideos ? <Video className="size-4" /> : <Volume2 className="size-4" />}
                title={`Da aggiungere: ${extras.join(', ')}`}
                detail={[videoDetail, o.narration ? `Voce narrante: ${p.narration.done} di ${p.narration.total}` : undefined].filter(Boolean).join(' · ') || undefined}
              />
            )}
            </ol>
          )}

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
            {view.status === 'paused' && slidesMode && (
              <Button variant="outline" onClick={() => setReviewOpen(true)}>
                Rivedi i copioni
              </Button>
            )}
            {view.status === 'paused' && (
              <Button onClick={() => void run(() => actions.resume.mutateAsync(), 'Generazione ripresa')} disabled={actions.resume.isPending}>
                {slidesMode ? 'Continua con i video' : 'Continua con i contenuti'}
              </Button>
            )}
            {view.errorCode === 'insufficient_credits' && (
              <a
                href="/wallet"
                className="inline-flex h-9 items-center rounded-md border border-amber-400 bg-amber-50 px-4 text-sm font-medium text-amber-900 hover:bg-amber-100"
              >
                Ricarica i crediti
              </a>
            )}
            {slidesMode && view.status === 'failed' && (
              <Button variant="outline" onClick={() => setReviewOpen(true)}>
                Cambia avatar o voce
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
              <Button
                onClick={() => {
                  // Generazione finita: si atterra sull'anteprima del corso, da dove decidi se modificarlo.
                  if (view.status === 'completed') {
                    try {
                      window.localStorage.setItem(wizardLandingKey(courseId), 'review');
                    } catch {
                      /* storage non disponibile: si parte dal primo passo */
                    }
                  }
                  void run(() => actions.dismiss.mutateAsync());
                }}
                disabled={actions.dismiss.isPending}
              >
                {view.status === 'completed' ? 'Vai all\u2019anteprima' : 'Continua a mano'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {view.status === 'paused' && !slidesMode && <CourseBuilder courseId={courseId} mode="structure" />}
      {slidesMode && <SlideVideoDialog courseId={courseId} open={reviewOpen} onClose={() => setReviewOpen(false)} />}

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
