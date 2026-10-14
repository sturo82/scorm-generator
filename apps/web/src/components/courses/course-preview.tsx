'use client';

import * as React from 'react';
import {
  INTERACTIONS_CSS,
  compileTheme,
  groupBlocksIntoConcepts,
  type Brand,
  type Block,
  type Assessment,
} from '@scorm/contracts';
import { buildCourseSteps } from '@scorm/contracts/render-core';
import { Skeleton } from '@/components/ui/skeleton';
import { EditorialStatusBadge } from '@/components/status-badge';
import { BlockRenderer } from '@/components/courses/block-renderer';
import { useCourse, useModules, useBrand, useAssessments, useAssessment } from '@/lib/api/hooks';
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

/** Gradiente brandizzato primario→accento (accento = secondary, fallback primario). */
const BRAND_ACCENT = 'var(--brand-secondary, var(--brand-primary, #4f46e5))';
const BRAND_ACCENT_GRADIENT =
  'linear-gradient(135deg, var(--brand-primary, #4f46e5), var(--brand-secondary, var(--brand-primary, #4f46e5)))';
/* Sfondo interno dell'avatar docente: tenue neutro (non il bianco del brand),
   così i ritratti PNG con trasparenza/soggetto chiaro restano sempre visibili. */
const AVATAR_INNER_BG =
  'radial-gradient(circle at 50% 32%, #f4f4f5 0%, #e4e4e7 72%, #d4d4d8 100%)';

/** Barra di avanzamento del corso, brandizzata (gradiente primario→accento). */
function CourseProgress({ current, total }: { current: number; total: number }) {
  const pct = total > 1 ? Math.round((current / (total - 1)) * 100) : 0;
  return (
    <div className="mb-5 flex items-center gap-3">
      <div
        className="h-2 flex-1 overflow-hidden rounded-full"
        style={{ background: 'color-mix(in srgb, var(--brand-on-surface, #111) 10%, transparent)' }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Avanzamento del corso"
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%`, background: BRAND_ACCENT_GRADIENT }}
        />
      </div>
      <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}

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
  const navPosition: 'side' | 'top' = course.data?.navPosition === 'top' ? 'top' : 'side';
  const [view, setView] = React.useState<ViewMode>('slide');

  const theme = React.useMemo(
    () => (brand.data ? compileTheme(toBrand(brand.data)) : null),
    [brand.data],
  );

  // URL del logo del brand pronto per <img>: preferisce il valore risolto dal
  // server (logoDisplayUrl, signed URL per i loghi caricati); se assente, usa
  // assets.logoPrimaryUrl SOLO quando è un URL esterno (non una storage key).
  const brandLogoUrl = React.useMemo(() => {
    const b = brand.data;
    if (!b) return null;
    if (b.logoDisplayUrl) return b.logoDisplayUrl;
    const raw = b.assets.logoPrimaryUrl;
    return raw && !raw.startsWith('storage:') ? raw : null;
  }, [brand.data]);

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
              {/* Avatar docente su sfondo brandizzato: la foto è CONTENUTA
                  (object-contain) dentro il cerchio pieno, senza tagli. */}
              <span
                className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full p-[2px] shadow-sm"
                style={{ background: BRAND_ACCENT_GRADIENT }}
                aria-hidden
              >
                {course.data.instructor.avatarUrl ? (
                  <span
                    className="grid size-full place-items-center overflow-hidden rounded-full"
                    style={{ background: AVATAR_INNER_BG }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- avatar docente */}
                    <img src={course.data.instructor.avatarUrl} alt="" className="size-full rounded-full object-contain" />
                  </span>
                ) : (
                  <span
                    className="grid size-full place-items-center rounded-full text-[10px] font-bold"
                    style={{ background: 'var(--brand-primary, #4f46e5)', color: 'var(--brand-on-primary, #fff)' }}
                  >
                    {course.data.instructor.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="truncate text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{course.data.instructor.name}</span>
                {course.data.instructor.role ? ` · ${course.data.instructor.role}` : ''}
              </span>
            </div>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">Docente non impostato</p>
          )}
        </div>
        {/* Logo del brand SEMPRE visibile, se il corso ha un brand con logo.
            Usa l'URL RISOLTO (logoDisplayUrl): per i loghi caricati
            assets.logoPrimaryUrl è una chiave di storage ("storage:…"), non un
            URL — usarla come src dà immagine rotta. Il server fornisce già il
            signed URL in logoDisplayUrl; per i loghi via URL esterno i due
            coincidono. */}
        {brandLogoUrl && (
          <span
            className="flex h-10 shrink-0 items-center rounded-lg px-2.5 shadow-sm"
            style={{ background: 'var(--brand-primary, #111)' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- logo del brand (signed URL) */}
            <img
              src={brandLogoUrl}
              alt={`Logo ${brand.data?.name ?? ''}`}
              className="h-6 w-auto max-w-[120px] object-contain"
            />
          </span>
        )}
        <ViewToggle value={view} onChange={setView} />
      </header>

      {/* Barra di avanzamento brandizzata (primario → accento). */}
      <CourseProgress current={current} total={steps.length} />

      {totalBlocks === 0 && (
        <p className="mb-4 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          La struttura esiste ma le lezioni non hanno ancora contenuti. Genera i contenuti nella
          scheda “Struttura e contenuti”.
        </p>
      )}

      {/* Layout: 'side' = due colonne (indice a sinistra); 'top' = indice
          espandibile sopra il contenuto. Coerente con il player SCORM. */}
      <div className={cn('grid gap-6', navPosition === 'side' && 'lg:grid-cols-[260px_1fr]')}>
        <CourseIndex
          steps={steps}
          currentStep={current}
          position={navPosition}
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
                <AssessmentPreview key={`assess-${step.assessment.id}`} courseId={courseId} step={step} />
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
                  className="rounded-lg px-4 py-2 text-sm font-semibold shadow-sm disabled:opacity-40"
                  style={{ background: BRAND_ACCENT_GRADIENT, color: 'var(--brand-on-primary, #fff)' }}
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
  position = 'side',
  onSelect,
}: {
  steps: PreviewStep[];
  currentStep: number;
  position?: 'side' | 'top';
  onSelect: (stepIndex: number) => void;
}) {
  const itemClass = (active: boolean, strong: boolean): string =>
    cn(
      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition',
      strong ? 'text-sm font-semibold' : 'text-sm',
      active ? 'text-primary-foreground' : strong ? 'text-foreground hover:bg-accent/40' : 'text-muted-foreground hover:bg-accent/40',
    );
  const activeStyle = (active: boolean): React.CSSProperties | undefined =>
    active ? { background: BRAND_ACCENT_GRADIENT, color: 'var(--brand-on-primary, #fff)' } : undefined;

  let moduleCount = 0;
  const list = (
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
                  <span
                    className={cn('grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold', active && 'bg-white/25')}
                    style={
                      active
                        ? undefined
                        : s.lesson.blocks.length > 0
                          ? { background: `color-mix(in srgb, ${BRAND_ACCENT} 18%, transparent)`, color: BRAND_ACCENT }
                          : { background: 'hsl(var(--muted))' }
                    }
                  >
                    {s.lesson.blocks.length > 0 ? '•' : '·'}
                  </span>
                  <span className="truncate">{s.lesson.title}</span>
                </button>
              </li>
            );
          }
          // assessment: badge "?" (test da svolgere), non una spunta — in
          // anteprima non c'è progressione, la ✓ sembrava "già superato".
          return (
            <li key={`assess-${s.assessment.id}`} className="pl-2">
              <button type="button" onClick={() => onSelect(i)} aria-current={active ? 'true' : undefined} className={itemClass(active, false)} style={activeStyle(active)}>
                <span className={cn('grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold', active ? 'bg-white/25' : 'bg-amber-500/20 text-amber-700')} aria-hidden>
                  ?
                </span>
                <span className="truncate">{s.assessment.title || (s.assessment.scope === 'final' ? 'Valutazione finale' : 'Test')}</span>
              </button>
            </li>
          );
        })}
      </ol>
  );

  // 'top': barra espandibile a tutta larghezza sopra il contenuto.
  if (position === 'top') {
    return (
      <details
        className="rounded-xl border bg-card p-2"
        style={{ borderTop: `3px solid ${BRAND_ACCENT}` }}
      >
        <summary className="cursor-pointer px-2 py-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: BRAND_ACCENT }}>
          Programma del corso
        </summary>
        <div className="mt-1">{list}</div>
      </details>
    );
  }

  // 'side' (default): sidebar sticky a sinistra.
  return (
    <nav
      className="h-max rounded-xl border bg-card p-3 lg:sticky lg:top-4"
      aria-label="Indice del corso"
      style={{ borderTop: `3px solid ${BRAND_ACCENT}` }}
    >
      <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: BRAND_ACCENT }}>
        Programma del corso
      </p>
      {list}
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
  courseId,
  step,
}: {
  courseId: string;
  step: { moduleTitle: string; assessment: AssessmentIndexView };
}) {
  const isFinal = step.assessment.scope === 'final';
  const detail = useAssessment(courseId, step.assessment.id);
  const questions = detail.data?.questions ?? [];

  return (
    <div className="rounded-2xl border bg-background p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">
        {isFinal ? 'Valutazione finale' : 'Test intermedio'} · {step.moduleTitle}
      </p>
      <h2 className="mt-1 text-xl font-bold">{step.assessment.title || 'Test'}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {isFinal
          ? 'Test finale del corso. Nel pacchetto SCORM è valutato e riporta l’esito all’LMS.'
          : 'Test intermedio: nel pacchetto SCORM blocca l’accesso al modulo successivo finché non è superato (gating).'}
      </p>

      {/* Anteprima AUTORE delle domande: mostra prompt e opzioni con la risposta
          corretta evidenziata. Nella fruizione reale (runtime SCORM) le risposte
          non sono rivelate: qui servono all'autore per rivedere il test. */}
      {detail.isLoading && <Skeleton className="mt-4 h-40 w-full" />}
      {detail.isError && (
        <p className="mt-4 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Impossibile caricare le domande di questo test.
        </p>
      )}
      {detail.data && questions.length > 0 && (
        <>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Anteprima domande ({questions.length})
            </p>
            <p className="text-[11px] text-muted-foreground">
              Soglia di superamento: {Math.round((detail.data.masteryScore ?? 0.8) * 100)}%
            </p>
          </div>
          <ol className="mt-3 space-y-4">
            {questions.map((q, i) => (
              <li key={q.id} className="rounded-xl border bg-muted/20 p-4">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                  <p className="text-sm font-medium">{questionPrompt(q)}</p>
                </div>
                <div className="mt-2 pl-8">
                  <QuestionBody question={q} />
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[11px] text-muted-foreground">
            Le risposte corrette sono evidenziate solo in questa anteprima autore; nel pacchetto
            SCORM il test è interattivo e valutato dal runtime.
          </p>
        </>
      )}
      {detail.data && questions.length === 0 && (
        <p className="mt-4 text-xs text-muted-foreground">Questo test non ha ancora domande.</p>
      )}
    </div>
  );
}

/** Testo della domanda (per fill_blank usa il template leggibile). */
function questionPrompt(q: Assessment['questions'][number]): string {
  if (q.type === 'fill_blank') return q.prompt || q.template;
  return q.prompt;
}

/** Rende il corpo di una domanda in base al tipo, evidenziando la risposta corretta. */
function QuestionBody({ question: q }: { question: Assessment['questions'][number] }) {
  const correct = 'rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-emerald-800 dark:text-emerald-300';
  const normal = 'rounded-md border px-2 py-1';
  switch (q.type) {
    case 'single_choice':
    case 'multiple_choice':
      return (
        <ul className="space-y-1.5 text-sm">
          {q.choices.map((c) => (
            <li key={c.id} className={c.correct ? correct : normal}>
              {c.correct ? '✓ ' : ''}
              {c.text}
            </li>
          ))}
        </ul>
      );
    case 'true_false':
      return (
        <p className="text-sm">
          Risposta corretta: <span className="font-semibold">{q.answer ? 'Vero' : 'Falso'}</span>
        </p>
      );
    case 'short_text':
      return (
        <p className="text-sm text-muted-foreground">
          Risposte accettate:{' '}
          <span className="font-medium text-foreground">{q.acceptedAnswers.join(', ')}</span>
        </p>
      );
    case 'matching':
      return (
        <ul className="space-y-1 text-sm">
          {q.pairs.map((p, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-medium">{p.left}</span>
              <span className="text-muted-foreground">→</span>
              <span>{p.right}</span>
            </li>
          ))}
        </ul>
      );
    case 'ordering':
      return (
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {[...q.items]
            .sort((a, b) => a.correctPosition - b.correctPosition)
            .map((it) => (
              <li key={it.id}>{it.label}</li>
            ))}
        </ol>
      );
    case 'fill_blank':
      return (
        <p className="text-sm text-muted-foreground">
          Spazi:{' '}
          <span className="font-medium text-foreground">
            {q.blanks.map((b) => b.accepted[0] ?? '—').join(', ')}
          </span>
        </p>
      );
    case 'interactive':
      return (
        <p className="text-sm text-muted-foreground">
          Interazione valutabile (blocco <code className="text-xs">{q.blockId}</code>).
        </p>
      );
    default:
      return null;
  }
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
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- copertina firmata */}
          <img src={course.coverImageUrl} alt="" className="h-56 w-full object-cover" />
          {course.coverAttribution && (
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/90">
              Foto di {course.coverAttribution.authorName} su{' '}
              {course.coverAttribution.provider.charAt(0).toUpperCase() +
                course.coverAttribution.provider.slice(1)}
            </span>
          )}
        </div>
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
            {/* Foto docente su sfondo brandizzato: la foto è CONTENUTA
                (object-contain) nel cerchio pieno, senza tagli. */}
            <span
              className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full p-[3px] shadow-sm"
              style={{ background: BRAND_ACCENT_GRADIENT }}
              aria-hidden
            >
            {course.instructor.avatarUrl ? (
              <span
                className="grid size-full place-items-center overflow-hidden rounded-full"
                style={{ background: AVATAR_INNER_BG }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- avatar docente */}
                <img src={course.instructor.avatarUrl} alt="" className="size-full rounded-full object-contain" />
              </span>
            ) : (
              <span
                className="grid size-full place-items-center rounded-full text-base font-bold"
                style={{ background: 'var(--brand-primary, #4f46e5)', color: 'var(--brand-on-primary, #fff)' }}
              >
                {course.instructor.name.charAt(0).toUpperCase()}
              </span>
            )}
            </span>
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
                    className="grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold"
                    style={{
                      background: 'var(--brand-primary, #4f46e5)',
                      color: 'var(--brand-on-primary, #fff)',
                    }}
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
                    className="grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold"
                    style={{
                      background: 'var(--brand-primary, #4f46e5)',
                      color: 'var(--brand-on-primary, #fff)',
                    }}
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
  return (
    css
      // I token del brand (:root/body) vengono definiti SIA sul contenitore
      // dell'anteprima SIA sul widget chat (fixed, fuori da .brand-scope nel
      // DOM): così anche la chat eredita i colori del CORSO.
      .replace(/:root\s*\{/g, '.brand-scope, .brand-chat-scope {')
      .replace(/\bbody\s*\{/g, '.brand-scope {')
      .replace(/\bh1, h2, h3, h4, h5, h6\s*\{/g, '.brand-scope :is(h1,h2,h3,h4,h5,h6) {') +
    '\n' +
    BRAND_TOKEN_BRIDGE_CSS
  );
}

/**
 * Rimappa i token SEMANTICI dell'app (Tailwind: --foreground, --primary,
 * --card…) sul brand del CORSO all'interno dell'anteprima (.brand-scope e del
 * widget chat .brand-chat-scope). Senza questo, le utility come text-foreground,
 * bg-primary, text-primary-foreground, bg-card eredita(va)no il tema dell'APP
 * (verde di piattaforma / grigi), non il brand del corso — e in alcuni casi
 * finivano sotto il contrasto AA sulla superficie del brand.
 *
 * I token Tailwind sono triplette HSL avvolte in hsl(var(--x)); usiamo quindi le
 * varianti --brand-*-hsl generate da compileTheme. I colori "on-" sono già resi
 * leggibili (>=4.5:1) dal compilatore, quindi testo su superficie/primario
 * risulta WCAG AA. Le superfici neutre (card/popover/background) restano chiare
 * usando la superficie del brand, con testo on-surface leggibile sopra.
 */
const BRAND_TOKEN_BRIDGE_CSS = `
.brand-scope, .brand-chat-scope {
  --background: var(--brand-surface-hsl, var(--background));
  --foreground: var(--brand-on-surface-hsl, var(--foreground));
  --card: var(--brand-surface-hsl, var(--card));
  --card-foreground: var(--brand-on-surface-hsl, var(--card-foreground));
  --popover: var(--brand-surface-hsl, var(--popover));
  --popover-foreground: var(--brand-on-surface-hsl, var(--popover-foreground));
  --primary: var(--brand-primary-hsl, var(--primary));
  --primary-foreground: var(--brand-on-primary-hsl, var(--primary-foreground));
  --secondary: var(--brand-secondary-hsl, var(--brand-primary-hsl, var(--secondary)));
  --secondary-foreground: var(--brand-on-secondary-hsl, var(--brand-on-primary-hsl, var(--secondary-foreground)));
  --ring: var(--brand-primary-hsl, var(--ring));
  /* Testo "attenuato": sul brand usiamo l'on-surface leggibile (>=4.5:1) invece
     del grigio dell'app, che su superfici del brand scure spariva. Si perde un
     filo di gerarchia visiva, ma il testo secondario resta sempre WCAG AA. */
  --muted-foreground: var(--brand-on-surface-hsl, var(--muted-foreground));
}
`;
