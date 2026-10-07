'use client';

import * as React from 'react';
import {
  INTERACTIONS_CSS,
  compileTheme,
  groupBlocksIntoConcepts,
  type Brand,
  type Block,
} from '@scorm/contracts';
import { buildCourseSteps } from '@scorm/contracts/render-core';
import { Skeleton } from '@/components/ui/skeleton';
import { EditorialStatusBadge } from '@/components/status-badge';
import { BlockRenderer } from '@/components/courses/block-renderer';
import { useCourse, useModules, useBrand, useAssessments } from '@/lib/api/hooks';
import { cn } from '@/lib/cn';
import type { AssessmentIndexView, BrandView, CourseView, LessonView, ModuleView } from '@/lib/api/types';
import { CourseRagWidget } from '@/components/courses/course-rag-widget';

type ViewMode = 'slide' | 'scroll' | 'hybrid';

/** Step della navigazione dell'anteprima (fedele a buildSteps del player). */
type LessonStep = {
  kind: 'lesson';
  moduleIndex: number;
  moduleTitle: string;
  lesson: LessonView;
  lessonIndexInModule: number;
};
type PreviewStep =
  | { kind: 'course_overview' }
  | { kind: 'module_overview'; moduleIndex: number; module: ModuleView }
  | LessonStep
  | { kind: 'assessment'; moduleTitle: string; assessment: AssessmentIndexView };

/** Adatta una BrandView del client al Brand dei contratti per compileTheme. */
function toBrand(b: BrandView): Brand {
  return {
    id: b.id,
    tenantId: b.tenantId,
    name: b.name,
    assets: b.assets,
    colors: b.colors as Brand['colors'],
    typography: b.typography,
    voice: b.voice,
  } as Brand;
}

/**
 * Anteprima reale del corso: stessa esperienza del runtime SCORM — brandizzata
 * (colori/logo/accenti del brand primario), fruizione a CONCETTI con 3 modalità
 * (slide/scorrimento/ibrido). È la vista da controllare prima dell'export.
 */
export function CoursePreview({ courseId }: { courseId: string }) {
  const modules = useModules(courseId);
  const assessments = useAssessments(courseId);
  const course = useCourse(courseId);
  const brand = useBrand(course.data?.primaryBrandId ?? '');
  const motion = course.data?.interactionStyle === 'lively' ? 'lively' : 'sober';
  const [view, setView] = React.useState<ViewMode>('slide');

  const theme = React.useMemo(
    () => (brand.data ? compileTheme(toBrand(brand.data)) : null),
    [brand.data],
  );

  // Sequenza lineare degli step del corso dalla STRUTTURA CONDIVISA
  // (buildCourseSteps di @scorm/contracts/render-core): stessa logica del player
  // SCORM. Gli assessment non sono disponibili in anteprima (non caricati qui),
  // quindi la sequenza copre panoramica corso → per modulo: panoramica + lezioni.
  const steps = React.useMemo<PreviewStep[]>(() => {
    const mods = modules.data ?? [];
    const asmts = assessments.data ?? [];
    const shared = buildCourseSteps({
      id: course.data?.id ?? 'preview',
      title: course.data?.title ?? 'Corso',
      modules: mods as never,
      assessments: asmts as never,
    });
    const out: PreviewStep[] = [];
    for (const s of shared) {
      if (s.kind === 'course_overview') out.push({ kind: 'course_overview' });
      else if (s.kind === 'module_overview')
        out.push({ kind: 'module_overview', moduleIndex: s.moduleIndex, module: mods[s.moduleIndex]! });
      else if (s.kind === 'lesson')
        out.push({
          kind: 'lesson',
          moduleIndex: s.moduleIndex,
          moduleTitle: s.moduleTitle,
          lesson: mods[s.moduleIndex]!.lessons[s.lessonIndexInModule]!,
          lessonIndexInModule: s.lessonIndexInModule,
        });
      else if (s.kind === 'assessment')
        out.push({ kind: 'assessment', moduleTitle: s.moduleTitle, assessment: s.assessment as unknown as AssessmentIndexView });
    }
    return out;
  }, [modules.data, assessments.data, course.data?.id, course.data?.title]);
  const [stepIdx, setStepIdx] = React.useState(0);

  if (modules.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!modules.data || modules.data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nessun contenuto da mostrare. Crea la struttura dall’outline e genera i contenuti.
      </p>
    );
  }

  const current = Math.min(stepIdx, Math.max(0, steps.length - 1));
  const step = steps[current];
  const totalBlocks = steps.reduce((a, s) => a + (s.kind === 'lesson' ? s.lesson.blocks.length : 0), 0);

  return (
    <div
      className="brand-scope rounded-2xl p-5 sm:p-6"
      data-motion={motion}
      style={{
        background:
          'radial-gradient(900px 320px at 50% -120px, color-mix(in srgb, var(--brand-primary, #4f46e5) 14%, transparent), transparent)',
      }}
    >
      {/* Tema del brand (colori/font) + micro-interazioni condivise. Scoping su
          .brand-scope per non invadere il resto dell'editor. */}
      <style dangerouslySetInnerHTML={{ __html: INTERACTIONS_CSS }} />
      {theme && (
        <style dangerouslySetInnerHTML={{ __html: scopeThemeCss(theme.css) }} />
      )}

      {/* Header del corso SEMPRE VISIBILE (sticky): copertina + titolo + docente,
          logo del brand e selettore modalità. */}
      <header
        className="sticky top-2 z-20 mb-5 flex flex-wrap items-center gap-4 rounded-2xl border p-3 shadow-sm backdrop-blur"
        style={{ background: 'color-mix(in srgb, var(--brand-surface, #fff) 85%, transparent)' }}
      >
        {course.data?.coverImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- copertina firmata
          <img
            src={course.data.coverImageUrl}
            alt=""
            className="hidden size-14 shrink-0 rounded-xl object-cover shadow-sm sm:block"
          />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-bold leading-tight">
            {course.data?.title ?? 'Corso'}
          </h2>
          {course.data?.instructor ? (
            <div className="mt-0.5 flex items-center gap-2">
              {course.data.instructor.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- avatar docente
                <img src={course.data.instructor.avatarUrl} alt="" className="size-5 rounded-full object-cover" />
              ) : (
                <span
                  className="grid size-5 place-items-center rounded-full text-[10px] font-bold text-primary-foreground"
                  style={{ background: 'var(--brand-primary, #4f46e5)' }}
                  aria-hidden
                >
                  {course.data.instructor.name.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="truncate text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{course.data.instructor.name}</span>
                {course.data.instructor.role ? ` · ${course.data.instructor.role}` : ''}
              </span>
            </div>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">Docente non impostato</p>
          )}
        </div>
        <ViewToggle value={view} onChange={setView} />
      </header>

      {totalBlocks === 0 && (
        <p className="mb-4 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          La struttura esiste ma le lezioni non hanno ancora contenuti. Genera i contenuti nella
          scheda “Struttura e contenuti”.
        </p>
      )}

      {/* Layout a due colonne: indice del corso + lezione corrente */}
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <CourseIndex
          steps={steps}
          currentStep={current}
          onSelect={(i) => setStepIdx(i)}
        />

        <div className="min-w-0">
          {step ? (
            <>
              {step.kind === 'lesson' ? (
                <LessonPreview key={step.lesson.id} step={step} view={view} />
              ) : step.kind === 'course_overview' ? (
                <CourseOverviewPreview
                  key="course-overview"
                  course={course.data}
                  modules={modules.data ?? []}
                />
              ) : step.kind === 'assessment' ? (
                <AssessmentPreview key={`assess-${step.assessment.id}`} step={step} />
              ) : (
                <ModuleOverviewPreview
                  key={`module-overview-${step.module.id}`}
                  module={step.module}
                  moduleIndex={step.moduleIndex}
                />
              )}
              <div className="mt-5 flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={current === 0}
                  onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
                  className="rounded-lg border bg-card px-4 py-2 text-sm font-semibold shadow-sm disabled:opacity-40"
                >
                  ‹ Precedente
                </button>
                <span className="text-xs text-muted-foreground">
                  {current + 1} di {steps.length}
                </span>
                <button
                  type="button"
                  disabled={current >= steps.length - 1}
                  onClick={() => setStepIdx((i) => Math.min(steps.length - 1, i + 1))}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm disabled:opacity-40"
                  style={{ background: 'var(--brand-primary, #4f46e5)' }}
                >
                  Successivo ›
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Nessuna lezione.</p>
          )}
        </div>
      </div>

      {/* Widget RAG "Chiedi al corso": stesso comportamento del pacchetto SCORM.
          Il salto porta alla lezione indicata (per riferimento lessonId). */}
      <CourseRagWidget
        courseId={courseId}
        onJump={(ref) => {
          if (ref.kind !== 'lesson' || !ref.lessonId) return;
          const idx = steps.findIndex((s) => s.kind === 'lesson' && s.lesson.id === ref.lessonId);
          if (idx >= 0) setStepIdx(idx);
        }}
      />
    </div>
  );
}

/**
 * Indice navigabile del corso guidato dalla SEQUENZA DI STEP condivisa (la
 * stessa di buildCourseSteps): panoramica → per modulo: panoramica + lezioni +
 * test, con il passo corrente evidenziato. Guidarlo dagli step garantisce che
 * indici e voci combacino con la navigazione (e con l'export).
 */
function CourseIndex({
  steps,
  currentStep,
  onSelect,
}: {
  steps: PreviewStep[];
  currentStep: number;
  onSelect: (stepIndex: number) => void;
}) {
  const itemClass = (active: boolean, strong: boolean): string =>
    cn(
      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition',
      strong ? 'text-sm font-semibold' : 'text-sm',
      active ? 'text-primary-foreground' : strong ? 'text-foreground hover:bg-accent/40' : 'text-muted-foreground hover:bg-accent/40',
    );
  const activeStyle = (active: boolean) =>
    active ? { background: 'var(--brand-primary, #4f46e5)' } : undefined;

  let moduleCount = 0;
  return (
    <nav className="h-max rounded-xl border bg-card p-3 lg:sticky lg:top-4" aria-label="Indice del corso">
      <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Programma del corso
      </p>
      <ol className="space-y-1">
        {steps.map((s, i) => {
          const active = i === currentStep;
          if (s.kind === 'course_overview') {
            return (
              <li key="course-overview">
                <button type="button" onClick={() => onSelect(i)} aria-current={active ? 'true' : undefined} className={itemClass(active, true)} style={activeStyle(active)}>
                  📋 Panoramica del corso
                </button>
              </li>
            );
          }
          if (s.kind === 'module_overview') {
            moduleCount += 1;
            const n = moduleCount;
            return (
              <li key={`mod-${s.module.id}`} className="pt-2">
                <button type="button" onClick={() => onSelect(i)} aria-current={active ? 'true' : undefined} className={itemClass(active, true)} style={activeStyle(active)}>
                  {n}. {s.module.title}
                </button>
              </li>
            );
          }
          if (s.kind === 'lesson') {
            return (
              <li key={`lesson-${s.lesson.id}`} className="pl-2">
                <button type="button" onClick={() => onSelect(i)} aria-current={active ? 'true' : undefined} className={itemClass(active, false)} style={activeStyle(active)}>
                  <span className={cn('grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold', active ? 'bg-white/25' : 'bg-muted')}>
                    {s.lesson.blocks.length > 0 ? '•' : '·'}
                  </span>
                  <span className="truncate">{s.lesson.title}</span>
                </button>
              </li>
            );
          }
          // assessment
          return (
            <li key={`assess-${s.assessment.id}`} className="pl-2">
              <button type="button" onClick={() => onSelect(i)} aria-current={active ? 'true' : undefined} className={itemClass(active, false)} style={activeStyle(active)}>
                <span className={cn('grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold', active ? 'bg-white/25' : 'bg-amber-500/20 text-amber-700')} aria-hidden>
                  ✓
                </span>
                <span className="truncate">{s.assessment.title || (s.assessment.scope === 'final' ? 'Valutazione finale' : 'Test')}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Anteprima di uno step di valutazione (test): nel player SCORM è il form del
 * quiz con gating; in anteprima mostriamo una scheda informativa (titolo, tipo,
 * posizione). Allinea indice e sequenza all'export senza duplicare il motore di
 * valutazione, che resta nel runtime SCORM.
 */
function AssessmentPreview({
  step,
}: {
  step: { moduleTitle: string; assessment: AssessmentIndexView };
}) {
  const isFinal = step.assessment.scope === 'final';
  return (
    <div className="rounded-2xl border bg-background p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">
        {isFinal ? 'Valutazione finale' : 'Test intermedio'} · {step.moduleTitle}
      </p>
      <h2 className="mt-1 text-xl font-bold">{step.assessment.title || 'Test'}</h2>
      <p className="mt-3 text-sm text-muted-foreground">
        {isFinal
          ? 'Test finale del corso. Nel pacchetto SCORM è valutato e riporta l’esito all’LMS.'
          : 'Test intermedio: nel pacchetto SCORM blocca l’accesso al modulo successivo finché non è superato (gating).'}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Le domande e la valutazione sono gestite dal runtime del pacchetto esportato.
      </p>
    </div>
  );
}

/** Pagina riepilogativa del CORSO: hero, descrizione, conteggi, docente, indice moduli. */
function CourseOverviewPreview({
  course,
  modules,
}: {
  course: CourseView | undefined;
  modules: ModuleView[];
}) {
  const totalLessons = modules.reduce((a, m) => a + m.lessons.length, 0);
  return (
    <article className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      {course?.coverImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- copertina firmata
        <img src={course.coverImageUrl} alt="" className="h-56 w-full object-cover" />
      )}
      <div className="space-y-5 p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Panoramica del corso
          </p>
          <h2 className="mt-1 text-2xl font-bold leading-tight">{course?.title ?? 'Corso'}</h2>
          {course?.description && (
            <p className="mt-2 text-pretty text-muted-foreground">{course.description}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <StatBadge value={modules.length} label={modules.length === 1 ? 'Modulo' : 'Moduli'} />
          <StatBadge value={totalLessons} label={totalLessons === 1 ? 'Lezione' : 'Lezioni'} />
        </div>

        {course?.instructor && (
          <div className="flex w-max max-w-full items-center gap-3 rounded-xl border bg-background p-3">
            {course.instructor.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- avatar docente
              <img src={course.instructor.avatarUrl} alt="" className="size-11 rounded-full object-cover" />
            ) : (
              <span
                className="grid size-11 place-items-center rounded-full text-base font-bold text-primary-foreground"
                style={{ background: 'var(--brand-primary, #4f46e5)' }}
                aria-hidden
              >
                {course.instructor.name.charAt(0).toUpperCase()}
              </span>
            )}
            <div className="flex flex-col">
              <strong className="text-sm">{course.instructor.name}</strong>
              {course.instructor.role && (
                <span className="text-xs text-muted-foreground">{course.instructor.role}</span>
              )}
            </div>
          </div>
        )}

        {modules.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Programma del corso
            </p>
            <ol className="space-y-2">
              {modules.map((m, mi) => (
                <li key={m.id} className="flex items-start gap-3 rounded-lg border bg-background p-3">
                  <span
                    className="grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold text-primary-foreground"
                    style={{ background: 'var(--brand-primary, #4f46e5)' }}
                  >
                    {mi + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{m.title}</p>
                    {m.summary && <p className="text-xs text-muted-foreground">{m.summary}</p>}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {m.lessons.length} {m.lessons.length === 1 ? 'lezione' : 'lezioni'}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </article>
  );
}

/** Pagina riepilogativa del MODULO: copertina, obiettivi, conteggio, elenco lezioni. */
function ModuleOverviewPreview({
  module: m,
  moduleIndex,
}: {
  module: ModuleView;
  moduleIndex: number;
}) {
  const objectives = m.objectives ?? [];
  return (
    <article className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      {m.coverImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- copertina firmata
        <img src={m.coverImageUrl} alt="" className="h-48 w-full object-cover" />
      )}
      <div className="space-y-5 p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Modulo {moduleIndex + 1}
          </p>
          <h2 className="mt-1 text-2xl font-bold leading-tight">{m.title}</h2>
          {m.summary && <p className="mt-2 text-pretty text-muted-foreground">{m.summary}</p>}
        </div>

        <div className="flex flex-wrap gap-3">
          <StatBadge value={m.lessons.length} label={m.lessons.length === 1 ? 'Lezione' : 'Lezioni'} />
        </div>

        {objectives.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Obiettivi
            </p>
            <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
              {objectives.map((o, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: 'var(--brand-primary, #4f46e5)' }} />
                  {o}
                </li>
              ))}
            </ul>
          </div>
        )}

        {m.lessons.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Lezioni del modulo
            </p>
            <ol className="space-y-1.5">
              {m.lessons.map((l, li) => (
                <li key={l.id} className="flex items-start gap-3 rounded-lg border bg-background p-3">
                  <span
                    className="grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold text-primary-foreground"
                    style={{ background: 'var(--brand-primary, #4f46e5)' }}
                  >
                    {li + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{l.title}</p>
                    {l.objectives.length > 0 && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {l.objectives.join(' · ')}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </article>
  );
}

/** Badge statistico con numero in evidenza e etichetta sotto. */
function StatBadge({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="flex min-w-[80px] flex-col items-center rounded-xl border px-4 py-2.5"
      style={{ background: 'color-mix(in srgb, var(--brand-primary, #4f46e5) 6%, transparent)' }}
    >
      <span className="text-xl font-extrabold" style={{ color: 'var(--brand-primary, #4f46e5)' }}>
        {value}
      </span>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

/** Anteprima di una lezione, a concetti, nella modalità scelta. Card coesa. */
function LessonPreview({
  step,
  view,
}: {
  step: { moduleIndex: number; moduleTitle: string; lesson: LessonView; lessonIndexInModule: number };
  view: ViewMode;
}) {
  const lesson = step.lesson;
  const concepts = React.useMemo(
    () => groupBlocksIntoConcepts(lesson.blocks as unknown as { type: string; payload?: unknown }[]),
    [lesson.blocks],
  );
  const [sub, setSub] = React.useState(0);
  const current = Math.min(sub, Math.max(0, concepts.length - 1));

  // Reset del concetto quando cambia lezione.
  React.useEffect(() => setSub(0), [lesson.id]);

  // Lezione VIDEO-FIRST (stile Brain Bites): in cima il video a tutta larghezza
  // con il suo pannello trascrizione/tab a fianco (gestito da VideoCheckpoint);
  // sotto, l'eventuale intro e gli elementi dinamici/quiz. Fedele al player SCORM.
  if (lesson.videoFirst) {
    const blocks = lesson.blocks as Block[];
    const videoBlock = blocks.find((b) => b.type === 'video_checkpoint');
    const rest = blocks.filter((b) => b.id !== videoBlock?.id);
    return (
      <article className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <header className="border-b p-5">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--brand-primary, #4f46e5)' }}>
            Modulo {step.moduleIndex + 1} · {step.moduleTitle} · Video
          </p>
          <div className="mt-1 flex items-center gap-2">
            <h3 className="text-xl font-bold">{lesson.title}</h3>
            <EditorialStatusBadge status={lesson.status} />
          </div>
        </header>
        <div className="space-y-5 p-5">
          {/* Video + trascrizione/tab a tutta larghezza */}
          {videoBlock && <BlockRenderer block={videoBlock} />}
          {/* Attività e approfondimenti sotto, in griglia responsive */}
          {rest.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {rest.map((b) => <BlockRenderer key={b.id} block={b} />)}
            </div>
          )}
        </div>
      </article>
    );
  }

  return (
    <article className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      {/* Intestazione lezione */}
      <header className="border-b p-5">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--brand-primary, #4f46e5)' }}>
          Modulo {step.moduleIndex + 1} · {step.moduleTitle}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <h3 className="text-xl font-bold">{lesson.title}</h3>
          <EditorialStatusBadge status={lesson.status} />
        </div>
        {lesson.objectives.length > 0 && (
          <ul className="mt-3 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
            {lesson.objectives.map((o, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1 size-1.5 shrink-0 rounded-full" style={{ background: 'var(--brand-primary, #4f46e5)' }} />
                {o}
              </li>
            ))}
          </ul>
        )}
        {lesson.narrationUrl && (
          <audio controls src={lesson.narrationUrl} className="mt-3 w-full max-w-md">
            Il tuo browser non supporta l&apos;audio.
          </audio>
        )}
      </header>

      {/* Corpo: concetti */}
      <div className="p-5">
      {concepts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nessun contenuto in questa lezione.</p>
      ) : view === 'scroll' ? (
        // Scorrimento: tutte le sezioni impilate.
        <div className="space-y-6">
          {concepts.map((c, ci) => (
            <ConceptSection key={ci} title={c.title} blocks={c.blocks as unknown as Block[]} index={ci} />
          ))}
        </div>
      ) : (
        // Slide / ibrido: un concetto per volta con stepper + nav.
        <div className="space-y-4">
          {concepts.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Concetti">
              {concepts.map((c, ci) => (
                <button
                  key={ci}
                  type="button"
                  role="tab"
                  aria-selected={ci === current}
                  onClick={() => setSub(ci)}
                  className={cn(
                    'grid size-7 place-items-center rounded-full border text-xs font-semibold transition',
                    ci === current
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent/40',
                  )}
                  title={c.title ?? `Concetto ${ci + 1}`}
                >
                  {ci + 1}
                </button>
              ))}
            </div>
          )}
          <ConceptSection
            title={concepts[current]?.title}
            blocks={(concepts[current]?.blocks ?? []) as unknown as Block[]}
            index={current}
          />
          {concepts.length > 1 && (
            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <button
                type="button"
                disabled={current === 0}
                onClick={() => setSub((s) => Math.max(0, s - 1))}
                className="rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-40"
              >
                ‹ Precedente
              </button>
              <span className="text-xs text-muted-foreground">
                Concetto {current + 1} di {concepts.length}
              </span>
              <button
                type="button"
                disabled={current >= concepts.length - 1}
                onClick={() => setSub((s) => Math.min(concepts.length - 1, s + 1))}
                className="rounded-lg border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
              >
                Successivo ›
              </button>
            </div>
          )}
        </div>
      )}
      </div>
    </article>
  );
}

function ConceptSection({ title, blocks, index }: { title?: string; blocks: Block[]; index: number }) {
  return (
    <section className="concept space-y-3" data-concept-index={index}>
      {title && <h4 className="concept-title text-base font-semibold">{title}</h4>}
      {blocks.map((b) => (
        <BlockRenderer key={b.id} block={b} />
      ))}
    </section>
  );
}

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const modes: Array<{ id: ViewMode; label: string }> = [
    { id: 'slide', label: 'Slide' },
    { id: 'scroll', label: 'Scorrimento' },
    { id: 'hybrid', label: 'Ibrido' },
  ];
  return (
    <div className="inline-flex gap-1 rounded-full bg-muted p-1" role="group" aria-label="Modalità di visualizzazione">
      {modes.map((m) => (
        <button
          key={m.id}
          type="button"
          aria-pressed={value === m.id}
          onClick={() => onChange(m.id)}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-semibold transition',
            value === m.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Limita le regole del tema del brand al contenitore .brand-scope, così i
 * token (:root/body) non alterano l'intera UI dell'editor. Riscrive i selettori
 * principali del CSS generato da compileTheme.
 */
function scopeThemeCss(css: string): string {
  return css
    .replace(/:root\s*\{/g, '.brand-scope {')
    .replace(/\bbody\s*\{/g, '.brand-scope {')
    .replace(/\bh1, h2, h3, h4, h5, h6\s*\{/g, '.brand-scope :is(h1,h2,h3,h4,h5,h6) {');
}
