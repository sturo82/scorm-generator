'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CheckCircle2, Clapperboard, Eye, FileText, Loader2, Palette, Play, Rocket, Sparkles, Wand2 } from 'lucide-react';
import { videoWordBudget } from '@scorm/contracts';
import { WordMeter } from '@/components/courses/word-meter';
import { apiErrorText } from '@/lib/api/error-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { CoursePreview } from '@/components/courses/course-preview';
import { CoursePricingPanel } from '@/components/courses/course-pricing-panel';
import { ExportDialog } from '@/components/courses/export-dialog';
import { SlidePipeline } from '@/components/courses/slide-video-dialog';
import { VideoDirector } from '@/components/courses/video-director';
import {
  useApplySlideChanges,
  useFitSlideScript,
  useVideoTiming,
  useSaveSlideScripts,
  useSlideChanges,
  useSlideClips,
  useSlideImport,
  useSlideLesson,
  useSlideScripts,
  useWallet,
} from '@/lib/api/hooks';
import type { SlideChangesView, SlideScriptEntry, VideoTiming } from '@/lib/api/types';

const fmt = (n: number) => n.toLocaleString('it-IT');

type Tab = 'preview' | 'scripts' | 'look' | 'publish';
const TABS: Array<{ id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'preview', label: 'Anteprima', icon: Eye },
  { id: 'scripts', label: 'Copioni e clip', icon: FileText },
  { id: 'look', label: 'Regia', icon: Palette },
  { id: 'publish', label: 'Pubblica', icon: Rocket },
];

/**
 * Studio video: dove si rivede e si modifica un corso nato da slide. Al posto del wizard a passi
 * (pensato per i corsi a testo), schede sul video: anteprima, copioni con le clip, aspetto del
 * montaggio e pubblicazione. Le modifiche si accumulano e si applicano insieme, con un solo costo.
 */
export function SlideStudio({ courseId, importId, onOpenClassic }: { courseId: string; importId: string; onOpenClassic: () => void }) {
  const [tab, setTab] = React.useState<Tab>('preview');
  const imp = useSlideImport(courseId, importId);
  const changes = useSlideChanges(courseId, importId);
  const lesson = useSlideLesson(courseId, importId);
  const lessonView = lesson.data && 'step' in lesson.data ? lesson.data : null;

  return (
    <div className="space-y-4">
      <Card className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-emerald-300 to-sky-300" />
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 pt-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
              <Clapperboard className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{imp.data?.filename ?? 'Video-lezione'}</p>
              <p className="text-xs text-muted-foreground">
                {imp.data ? `${imp.data.slides.length} ${imp.data.kind === 'videos' ? 'video' : 'slide'}` : ''}
                {lessonView?.status === 'completed' ? ' · video pronto' : lessonView?.status === 'running' ? ' · montaggio in corso' : ''}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onOpenClassic} title="La vista a passi dei corsi a testo">
            Editor classico
          </Button>
        </CardContent>
      </Card>

      <ChangesBar courseId={courseId} importId={importId} view={changes.data} loading={changes.isLoading} />

      <div role="tablist" aria-label="Sezioni dello Studio video" className="flex gap-1 overflow-x-auto rounded-lg border bg-muted/30 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
              tab === t.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <t.icon className="size-4" /> {t.label}
            {t.id === 'scripts' && (changes.data?.clips.slides ?? 0) > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold text-white">{changes.data!.clips.slides}</span>
            )}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'preview' && <CoursePreview courseId={courseId} />}
        {tab === 'scripts' && (
          <div className="space-y-8">
            <StudioScripts courseId={courseId} importId={importId} changes={changes.data} />
            <SlidePipeline courseId={courseId} importId={importId} show={['header', 'clips']} />
          </div>
        )}
        {tab === 'look' && (
          <div className="space-y-4">
            <VideoDirector courseId={courseId} importId={importId} />
            <details className="group rounded-lg border bg-muted/20">
              <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground">
                Copertina, schermata finale, sottotitoli e brand
              </summary>
              <div className="border-t p-4">
                <SlidePipeline courseId={courseId} importId={importId} show={['lesson']} />
              </div>
            </details>
          </div>
        )}
        {tab === 'publish' && (
          <div className="space-y-6">
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">Esporta il pacchetto SCORM</p>
                  <p className="text-sm text-muted-foreground">Controlla prima l&apos;anteprima: il pacchetto contiene il video, il riepilogo e il quiz.</p>
                </div>
                <ExportDialog courseId={courseId} />
              </CardContent>
            </Card>
            <details className="group rounded-lg border bg-muted/20">
              <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground">Crediti usati</summary>
              <div className="border-t p-4">
                <CoursePricingPanel courseId={courseId} />
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

/** Barra delle modifiche: cosa va rifatto, quanto costa in totale e un solo pulsante per applicarlo. */
function ChangesBar({ courseId, importId, view, loading }: { courseId: string; importId: string; view?: SlideChangesView; loading: boolean }) {
  const toast = useToast();
  const wallet = useWallet();
  const apply = useApplySlideChanges(courseId, importId);
  const billed = view?.billed ?? wallet.data?.enabled === true;
  if (loading || !view) return <Skeleton className="h-14 w-full" />;

  if (view.running) {
    return (
      <div role="status" className="relative overflow-hidden rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
        <span aria-hidden className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-primary/10 to-transparent motion-safe:animate-shimmer" />
        <p className="relative flex items-center gap-2 font-medium">
          <Loader2 className="size-4 animate-spin text-primary" />
          {view.running === 'clips' ? 'Sto rigenerando le clip modificate…' : 'Sto rimontando il video…'}
        </p>
        <p className="relative text-xs text-muted-foreground">Gira sul server: puoi continuare a lavorare o lasciare la pagina.</p>
      </div>
    );
  }
  if (!view.pending) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-emerald-300/60 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        <CheckCircle2 className="size-4" /> Il video è aggiornato con i tuoi copioni.
      </p>
    );
  }
  const parts: string[] = [];
  if (view.clips.slides > 0) parts.push(`${view.clips.slides} ${view.clips.slides === 1 ? 'clip da rigenerare' : 'clip da rigenerare'}`);
  if (view.removed > 0) parts.push(`${view.removed} ${view.removed === 1 ? 'slide esclusa' : 'slide escluse'}`);
  parts.push('rimontaggio del video');

  async function run() {
    try {
      await apply.mutateAsync();
      toast.show('Modifiche in applicazione', 'success');
    } catch (err) {
      toast.show(err instanceof Error ? err.message.replace(/^API \d+:\s*/, '') : 'Operazione non riuscita', 'error');
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-950">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4 shrink-0" /> Modifiche da applicare al video
        </p>
        <p className="text-xs">
          {parts.join(' + ')}
          {billed && view.total !== null ? (
            <>
              {' · '}al massimo <strong>{fmt(view.total)} crediti</strong>
              {view.clips.credits ? ` (clip ${fmt(view.clips.credits)}, montaggio ${fmt(view.render.credits ?? 0)})` : ''}
            </>
          ) : null}
          . Le altre clip restano quelle già generate.
        </p>
      </div>
      <Button onClick={() => void run()} disabled={apply.isPending}>
        {apply.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Applica modifiche
      </Button>
    </div>
  );
}

/**
 * Copioni slide per slide, modificabili anche dopo la generazione: accanto a ogni slide il testo
 * parlato, lo stato della sua clip e un'anteprima della clip. Salvando, le clip da rifare si
 * sommano nella barra delle modifiche.
 */
export function StudioScripts({
  courseId,
  importId,
  changes,
  review = false,
}: {
  courseId: string;
  importId: string;
  changes?: SlideChangesView;
  /** Revisione prima delle clip (generazione automatica in pausa): niente clip né tempi reali. */
  review?: boolean;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const imp = useSlideImport(courseId, importId);
  const scripts = useSlideScripts(courseId, importId);
  const clips = useSlideClips(courseId, importId);
  const save = useSaveSlideScripts(courseId, importId);
  const fit = useFitSlideScript(courseId, importId);
  const isVideo = Boolean(imp.data?.kind === 'videos');
  const timing = useVideoTiming(courseId, importId, isVideo && !review);
  const timingOf = (i: number) => timing.data?.find((t) => t.index === i);
  const videoOf = (i: number) => imp.data?.slides.find((x) => x.index === i)?.video;
  const doc = scripts.data && 'slides' in scripts.data ? scripts.data : null;
  const clipsView = clips.data && 'clips' in clips.data ? clips.data : null;
  const [draft, setDraft] = React.useState<SlideScriptEntry[]>([]);
  const [dirty, setDirty] = React.useState(false);
  const [playing, setPlaying] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (doc && !dirty) setDraft(doc.slides);
  }, [doc, dirty]);

  const thumbs = new Map((imp.data?.slides ?? []).map((s) => [s.index, s.imageUrl]));
  const stale = new Set(changes?.clips.indexes ?? []);
  const clipOf = (i: number) => clipsView?.clips.find((c) => c.index === i);

  if (scripts.isLoading) return <Skeleton className="h-40 w-full" />;
  if (!doc) return <p className="text-sm text-muted-foreground">I copioni non sono ancora pronti.</p>;

  function patch(index: number, change: Partial<SlideScriptEntry>) {
    setDirty(true);
    setDraft((cur) => cur.map((x) => (x.index === index ? { ...x, ...change } : x)));
  }

  async function onFit(index: number) {
    if (dirty) {
      toast.show('Salva prima le modifiche ai copioni', 'info');
      return;
    }
    try {
      await fit.mutateAsync(index);
      toast.show(review ? 'Copione adattato alla durata del video' : 'Copione adattato: la clip è tra le modifiche da applicare', 'success');
    } catch (err) {
      toast.show(err instanceof Error ? err.message.replace(/^API \d+:\s*/, '').slice(0, 160) : 'Adattamento non riuscito', 'error');
    }
  }

  async function onSave() {
    try {
      await save.mutateAsync({ slides: draft.map((d) => ({ index: d.index, script: d.script, skip: d.skip })), approved: true });
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ['courses', courseId, 'slides', importId, 'changes'] });
      toast.show('Copioni salvati: le clip da rifare sono nella barra in alto', 'success');
    } catch (err) {
      toast.show(apiErrorText(err, 'Salvataggio non riuscito'), 'error');
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Copioni</h3>
          <p className="text-xs text-muted-foreground">
            {isVideo
              ? 'Ogni copione è tarato sulla durata del suo video: la barra diventa verde quando voce e video finiscono insieme.'
              : null}{' '}
            {review
              ? 'Correggi i testi, salva e poi continua con le clip.'
              : 'Modifica il testo che l\u2019avatar pronuncia. Salvando, solo le clip cambiate vengono rigenerate quando premi «Applica modifiche».'}
          </p>
        </div>
        <Button onClick={() => void onSave()} disabled={!dirty || save.isPending}>
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Salva i copioni
        </Button>
      </div>
      <ul className="space-y-3">
        {draft.map((d) => {
          const clip = clipOf(d.index);
          const thumb = thumbs.get(d.index);
          const needs = stale.has(d.index);
          const status = d.skip
            ? { label: 'Esclusa dal video', tone: 'bg-muted text-muted-foreground' }
            : clip?.state === 'failed'
              ? { label: 'Clip con errore', tone: 'bg-red-100 text-red-800' }
              : needs
                ? { label: 'Da rigenerare', tone: 'bg-amber-100 text-amber-900' }
                : clip?.state === 'completed'
                  ? { label: 'Clip aggiornata', tone: 'bg-emerald-100 text-emerald-900' }
                  : { label: 'In attesa', tone: 'bg-muted text-muted-foreground' };
          return (
            <li key={d.index} className={cn('grid gap-3 rounded-lg border p-3 sm:grid-cols-[168px_1fr]', d.skip && 'opacity-70')}>
              <div className="space-y-2">
                <div className="relative aspect-video overflow-hidden rounded-md border bg-muted">
                  {playing === d.index && clip?.clipUrl ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption -- anteprima della clip
                    <video src={clip.clipUrl} controls autoPlay className="size-full object-contain" onEnded={() => setPlaying(null)} />
                  ) : thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element -- anteprima remota
                    <img src={thumb} alt={`Slide ${d.index}`} className="size-full object-cover" />
                  ) : (
                    <div className="grid size-full place-items-center p-2 text-center text-[11px] text-muted-foreground">{d.extra?.title ?? `Slide ${d.index}`}</div>
                  )}
                  {clip?.clipUrl && playing !== d.index && !needs && (
                    <button
                      type="button"
                      onClick={() => setPlaying(d.index)}
                      className="absolute bottom-1 right-1 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[11px] text-white hover:bg-black/85"
                      aria-label={`Guarda la clip della slide ${d.index}`}
                    >
                      <Play className="size-3" /> clip
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-medium">{isVideo ? 'Video' : 'Slide'} {d.index}</span>
                  <span className={cn('rounded-full px-2 py-0.5 font-medium', status.tone)}>{status.label}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <textarea
                  value={d.script}
                  disabled={d.skip}
                  onChange={(e) => patch(d.index, { script: e.target.value })}
                  rows={Math.min(8, Math.max(3, Math.ceil(d.script.length / 90)))}
                  className="w-full resize-y rounded-md border bg-background p-2 text-sm leading-relaxed disabled:bg-muted/40"
                  aria-label={`Copione della slide ${d.index}`}
                />
                {d.targetSec ? (
                  <div className="space-y-1.5">
                    <WordMeter text={d.script} durationSec={d.targetSec} wordsPerSec={doc.wordsPerSec} />
                    <TimingNote
                      t={timingOf(d.index)}
                      needs={needs}
                      onFit={() => void onFit(d.index)}
                      fitting={fit.isPending && fit.variables === d.index}
                      outOfRange={!d.skip && (() => {
                        const w = d.script.trim() ? d.script.trim().split(/\s+/).length : 0;
                        const b = videoWordBudget(d.targetSec!, doc.wordsPerSec);
                        return w > b.max || w < b.min;
                      })()}
                      hint={videoOf(d.index)?.hint}
                    />
                  </div>
                ) : null}
                {(d.conflicts?.length ?? 0) > 0 && (
                  <p className="rounded-md border border-amber-300/60 bg-amber-50 p-2 text-xs text-amber-900">
                    <strong>Contraddizione con la knowledge:</strong> {d.conflicts!.join(' · ')}
                  </p>
                )}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {d.script.trim() ? d.script.trim().split(/\s+/).length : 0} parole
                  </span>
                  <label className="inline-flex cursor-pointer items-center gap-1.5">
                    <input type="checkbox" checked={d.skip} onChange={(e) => patch(d.index, { skip: e.target.checked })} />
                    Escludi dal video
                  </label>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Stato della taratura di un video: suggerisce «Adatta alla durata» se il copione non ci sta e,
 * a clip generate, dice come il montaggio fa combaciare voce e video.
 */
function TimingNote({
  t,
  needs,
  onFit,
  fitting,
  outOfRange,
  hint,
}: {
  t?: VideoTiming;
  needs: boolean;
  onFit: () => void;
  fitting: boolean;
  outOfRange: boolean;
  hint?: string;
}) {
  const bad = !needs && t && (t.mode === 'freeze' || t.mode === 'cut');
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      {t && !needs && (
        <span
          className={cn(
            'rounded-full px-2 py-0.5 font-medium',
            bad ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900',
          )}
          title={`Voce ${t.voiceSec} s · video ${Math.round(t.videoSec * 10) / 10} s`}
        >
          {t.mode === 'match'
            ? 'Voce e video coincidono'
            : t.mode === 'speed'
              ? `Video adattato alla voce (${t.rate < 1 ? 'più lento' : 'più veloce'} del ${Math.round(Math.abs(1 - t.rate) * 100)}%)`
              : t.mode === 'freeze'
                ? `La voce dura ${Math.round(t.voiceSec - t.videoSec)} s più del video: resta fermo sull'ultimo fotogramma`
                : `Il video dura ${Math.round(t.videoSec - t.voiceSec)} s più della voce: viene tagliato`}
        </span>
      )}
      {(outOfRange || bad) && (
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={onFit} disabled={fitting}>
          {fitting ? <Loader2 className="size-3 animate-spin" /> : <Wand2 className="size-3" />} {bad ? 'Ritara sulla durata' : 'Adatta alla durata'}
        </Button>
      )}
      {hint && <span className="text-muted-foreground">Indicazione: {hint}</span>}
    </div>
  );
}
