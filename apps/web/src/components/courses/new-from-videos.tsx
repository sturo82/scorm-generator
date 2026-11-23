'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Eye,
  FileText,
  Film,
  Info,
  Lightbulb,
  Loader2,
  PenLine,
  Scissors,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { VIDEO_SCRIPT, videoWordBudget } from '@scorm/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dropzone } from '@/components/knowledge/dropzone';
import { useToast } from '@/components/ui/toast';
import { SlideAvatarPicker, type AvatarChoice } from '@/components/courses/slide-avatar-picker';
import { WordMeter } from '@/components/courses/word-meter';
import { cn } from '@/lib/cn';
import { getApiClient } from '@/lib/api/client';
import { useKnowledge, useSlideImportEstimate, useWallet } from '@/lib/api/hooks';
import type { SlideImportView } from '@/lib/api/types';
import { videoDuration, videoStills } from '@/lib/video-frames';

const fmt = (n: number) => n.toLocaleString('it-IT');
const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const ACCEPT = 'video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov';
const TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

type Mode = 'frames' | 'hint' | 'manual';
interface Item {
  id: string;
  file: File;
  url: string;
  durationSec: number;
  trim: { start: number; end: number } | null;
  mode: Mode;
  hint: string;
  script: string;
  progress?: number;
}

const MODES: Array<{ id: Mode; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }> = [
  { id: 'frames', label: 'L’AI guarda il video', icon: Eye, hint: 'Scrive il copione da ciò che si vede (funziona anche senza audio)' },
  { id: 'hint', label: 'Indicazione per l’AI', icon: Lightbulb, hint: 'Due righe su cosa deve dire: l’AI scrive il copione' },
  { id: 'manual', label: 'Scrivo io', icon: PenLine, hint: 'Copione esatto, tarato sulla durata' },
];

const len = (it: Item) => (it.trim ? Math.max(0.5, it.trim.end - it.trim.start) : it.durationSec);

/**
 * Percorso "da video": carichi i video (ognuno diventa un capitolo, come una slide), scegli per
 * ognuno come nasce il copione — tarato sulla sua durata — e l'avatar che li racconta. Il resto
 * lo fa la generazione automatica: copioni, revisione, clip con l'avatar e montaggio.
 */
export function NewFromVideos({
  courseId,
  title,
  language,
  initialFiles,
  onSwitch,
}: {
  courseId: string;
  title: string;
  language: string;
  /** Video già scelti nel passo precedente: si leggono subito. */
  initialFiles?: File[];
  /** Torna alla scelta del materiale (per caricare un PDF invece dei video). */
  onSwitch?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const wallet = useWallet();
  const knowledge = useKnowledge('GLOBAL');
  const [items, setItems] = React.useState<Item[]>([]);
  const [reading, setReading] = React.useState(0);
  const [uploading, setUploading] = React.useState(false);
  const [imported, setImported] = React.useState<SlideImportView | null>(null);
  const [choice, setChoice] = React.useState<AvatarChoice | null>(null);
  const [docIds, setDocIds] = React.useState<string[]>([]);
  const [reviewScripts, setReviewScripts] = React.useState(true);
  const [sections, setSections] = React.useState(false);
  const [starting, setStarting] = React.useState(false);

  React.useEffect(() => () => items.forEach((i) => URL.revokeObjectURL(i.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const readyDocs = React.useMemo(() => (knowledge.data ?? []).filter((d) => d.status === 'READY'), [knowledge.data]);
  const estimate = useSlideImportEstimate(courseId, imported?.importId ?? '', sections, Boolean(imported), {
    engine: choice?.engine,
    avatarType: choice?.avatarType,
  });
  const quote = estimate.data ? (docIds.length > 0 ? estimate.data.withKnowledge : estimate.data.slidesOnly) : null;
  const available = wallet.data?.available ?? wallet.data?.balance;
  const notEnough = Boolean(quote?.priced && estimate.data?.billed && available !== undefined && available < quote.total);

  const patch = (id: string, p: Partial<Item>) => setItems((cur) => cur.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const move = (i: number, d: -1 | 1) =>
    setItems((cur) => {
      const next = [...cur];
      const j = i + d;
      if (j < 0 || j >= next.length) return cur;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  async function onFiles(files: File[]) {
    const room = VIDEO_SCRIPT.maxVideos - items.length;
    if (room <= 0) {
      toast.show(`Al massimo ${VIDEO_SCRIPT.maxVideos} video`, 'error');
      return;
    }
    for (const f of files.slice(0, room)) {
      if (!TYPES.includes(f.type) && !/\.(mp4|webm|mov)$/i.test(f.name)) {
        toast.show(`${f.name}: usa MP4, WebM o MOV`, 'error');
        continue;
      }
      if (f.size > VIDEO_SCRIPT.maxVideoBytes) {
        toast.show(`${f.name}: troppo grande (max ${VIDEO_SCRIPT.maxVideoBytes / 1024 / 1024} MB)`, 'error');
        continue;
      }
      setReading((n) => n + 1);
      try {
        const durationSec = await videoDuration(f, { longSide: VIDEO_SCRIPT.maxLongSidePx, shortSide: VIDEO_SCRIPT.maxShortSidePx });
        setItems((cur) => [
          ...cur,
          { id: crypto.randomUUID(), file: f, url: URL.createObjectURL(f), durationSec, trim: null, mode: 'frames', hint: '', script: '' },
        ]);
      } catch (err) {
        toast.show(`${f.name}: ${err instanceof Error ? err.message : 'video non leggibile'}`, 'error');
      } finally {
        setReading((n) => n - 1);
      }
    }
  }

  const started = React.useRef(false);
  React.useEffect(() => {
    if (initialFiles?.length && !started.current) {
      started.current = true;
      void onFiles(initialFiles);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFiles]);

  const problems = items
    .map((it, i) => {
      if (it.mode === 'manual' && !it.script.trim()) return `Scrivi il copione del video ${i + 1}`;
      if (it.mode === 'hint' && !it.hint.trim()) return `Scrivi l’indicazione per il video ${i + 1}`;
      if (it.mode === 'manual') {
        const w = it.script.trim().split(/\s+/).length;
        if (w > videoWordBudget(len(it)).max) return `Il copione del video ${i + 1} è più lungo del video`;
      }
      if (it.trim && it.trim.end - it.trim.start < 2) return `Il tratto del video ${i + 1} è troppo corto`;
      return null;
    })
    .filter(Boolean) as string[];

  /** Carica i video (con copertina e fotogrammi del tratto), poi salva ordine, tratti e copioni. */
  async function upload() {
    setUploading(true);
    const api = getApiClient();
    try {
      const imp = await api.createVideoImport(courseId, { title: title.trim() || undefined, language });
      let view: SlideImportView = imp;
      for (const it of items) {
        patch(it.id, { progress: 0 });
        const stills = await videoStills(it.file, it.trim ?? undefined);
        view = await api.addImportVideo(
          courseId,
          imp.importId,
          { file: it.file, poster: stills.poster, frames: stills.frames, durationSec: it.durationSec },
          (p) => patch(it.id, { progress: p }),
        );
        patch(it.id, { progress: 1 });
      }
      // Gli indici seguono l'ordine di caricamento, che è quello scelto.
      view = await api.updateImportVideos(courseId, imp.importId, {
        videos: items.map((it, i) => ({
          index: view.slides[i]!.index,
          mode: it.mode,
          ...(it.mode === 'hint' ? { hint: it.hint.trim() } : {}),
          ...(it.mode === 'manual' ? { script: it.script.trim() } : {}),
          ...(it.trim ? { trim: it.trim } : {}),
        })),
      });
      setImported(view);
    } catch (err) {
      const msg = err instanceof Error ? err.message.replace(/^API \d+:\s*/, '') : '';
      toast.show(msg.slice(0, 200) || 'Caricamento non riuscito', 'error');
      setItems((cur) => cur.map((x) => ({ ...x, progress: undefined })));
    } finally {
      setUploading(false);
    }
  }

  async function start() {
    if (!imported || !choice) return;
    setStarting(true);
    try {
      await getApiClient().startAutopilot(courseId, {
        reviewStructure: false,
        slides: {
          importId: imported.importId,
          avatarId: choice.avatarId,
          avatarType: choice.avatarType,
          engine: choice.engine,
          ...(choice.voiceId ? { voiceId: choice.voiceId } : {}),
          knowledgeDocIds: docIds,
          reviewScripts,
          moduleTitle: title.trim() || undefined,
          sections,
        },
      });
      try {
        window.localStorage.setItem(`slide-video-import:${courseId}`, imported.importId);
      } catch {
        /* storage non disponibile */
      }
      router.push(`/courses/${courseId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message.replace(/^API \d+:\s*/, '') : '';
      toast.show(msg || 'Generazione non avviata', 'error');
      setStarting(false);
    }
  }

  const totalSec = items.reduce((t, it) => t + len(it), 0);

  // --- Dopo il caricamento: avatar e avvio --------------------------------------
  if (imported) {
    return (
      <div className="flex flex-col gap-5">
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">1. I tuoi video</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => setImported(null)} disabled={starting}>
              Modifica i video
            </Button>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-emerald-300/60 bg-emerald-50 p-3 text-sm text-emerald-900">
            <CheckCircle2 className="size-5 shrink-0" aria-hidden />
            <span>
              {imported.slides.length} video caricati · {fmtTime(totalSec)} in tutto. Copioni:{' '}
              {items.filter((x) => x.mode === 'manual').length} scritti da te, {items.filter((x) => x.mode !== 'manual').length} dall&apos;AI.
            </span>
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-sm font-medium">2. Chi li racconta</p>
          <SlideAvatarPicker courseId={courseId} language={language} onChange={setChoice} />
        </section>

        {readyDocs.length > 0 && items.some((x) => x.mode !== 'manual') && (
          <section className="space-y-2">
            <p className="text-sm font-medium">
              3. Knowledge per l&apos;AI <span className="font-normal text-muted-foreground">(facoltativa)</span>
            </p>
            <div className="flex max-h-40 flex-col gap-1 overflow-auto rounded-lg border p-2">
              {readyDocs.map((d) => (
                <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent/50">
                  <input
                    type="checkbox"
                    className="size-4 accent-[hsl(var(--primary))]"
                    checked={docIds.includes(d.id)}
                    onChange={(e) => setDocIds((prev) => (e.target.checked ? [...prev, d.id] : prev.filter((x) => x !== d.id)))}
                  />
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{d.filename}</span>
                </label>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[hsl(var(--primary))]" checked={reviewScripts} onChange={(e) => setReviewScripts(e.target.checked)} />
            <span>
              Voglio rivedere i copioni prima di generare i video
              <span className="block text-xs text-muted-foreground">
                La generazione si ferma dopo i copioni. Si ferma da sola anche se un copione non è tarato sulla durata del suo video.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[hsl(var(--primary))]" checked={sections} onChange={(e) => setSections(e.target.checked)} />
            <span>
              Dividi in sezioni, ognuna con il suo quiz
              <span className="block text-xs text-muted-foreground">Utile con molti video; altrimenti è una sola video-lezione.</span>
            </span>
          </label>
        </section>

        <section className="rounded-lg border bg-accent/30 p-3 text-sm">
          {!estimate.data && estimate.isLoading ? (
            <Skeleton className="h-5 w-56" />
          ) : quote && estimate.data?.billed ? (
            quote.priced ? (
              <p>
                Al massimo <strong>{fmt(quote.total)} crediti</strong> per circa {quote.minutes} min: copioni, clip con l&apos;avatar, montaggio, riepilogo e quiz.
                Paghi solo quanto viene usato davvero.
              </p>
            ) : (
              <p className="text-muted-foreground">Il prezzo di alcune voci non è ancora disponibile.</p>
            )
          ) : (
            <p className="text-muted-foreground">Il costo dipende dalla durata dei video.</p>
          )}
        </section>

        {notEnough && quote && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900">
            <span>
              Servono fino a <strong>{fmt(quote.total)}</strong> crediti, ne hai <strong>{fmt(available ?? 0)}</strong>.
            </span>
            <a href="/wallet" className="font-medium underline">
              Ricarica
            </a>
          </div>
        )}

        <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          L&apos;audio originale dei video resta muto: si sente solo l&apos;avatar. Se voce e video differiscono di poco, il video rallenta o accelera
          appena per finire insieme. Alla fine trovi tutto nell&apos;anteprima, pronto da rivedere.
        </div>

        <Button type="button" size="lg" disabled={!choice || starting || notEnough} onClick={() => void start()}>
          {starting ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
          {starting ? 'Avvio…' : choice ? 'Crea e genera il corso' : 'Scegli un avatar'}
        </Button>
      </div>
    );
  }

  // --- Prima del caricamento: video, ordine, tratti e copioni -------------------
  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">1. I tuoi video, nell&apos;ordine in cui vanno raccontati</p>
        <Dropzone
          onFiles={(f) => void onFiles(f)}
          accept={ACCEPT}
          disabled={uploading}
          title={items.length ? 'Aggiungi altri video' : 'Trascina qui i tuoi video'}
          hint={`MP4, WebM o MOV · fino a 1080p e ${VIDEO_SCRIPT.maxVideoBytes / 1024 / 1024} MB ciascuno`}
        />
        <p className="text-xs text-muted-foreground">
          Al massimo {VIDEO_SCRIPT.maxVideos} video. Ogni video diventa un capitolo con l&apos;avatar che lo racconta.
        </p>
        {reading > 0 && (
          <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Leggo i video…
          </p>
        )}
        {onSwitch && items.length === 0 && reading === 0 && (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={onSwitch}>
            Hai un PDF di slide invece dei video?
          </button>
        )}
      </div>

      <ol className="space-y-3">
        {items.map((it, i) => {
          const duration = len(it);
          const b = videoWordBudget(duration);
          return (
            <li key={it.id} className="rounded-xl border bg-card p-3 shadow-sm">
              <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
                <div className="space-y-1.5">
                  <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption -- anteprima locale */}
                    <video
                      src={`${it.url}#t=${it.trim?.start ?? 0.1}`}
                      controls
                      muted
                      playsInline
                      preload="metadata"
                      className="size-full object-contain"
                      id={`vid-${it.id}`}
                    />
                    <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 text-[11px] font-semibold text-white">{i + 1}</span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground" title={it.file.name}>
                    <Film className="mr-1 inline size-3" />
                    {it.file.name}
                  </p>
                  <p className="text-xs">
                    Durata usata <strong>{fmtTime(duration)}</strong>
                    {it.trim ? <span className="text-muted-foreground"> di {fmtTime(it.durationSec)}</span> : null}
                  </p>
                  {it.progress !== undefined && (
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-label="Caricamento">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(it.progress * 100)}%` }} />
                    </div>
                  )}
                </div>

                <div className="min-w-0 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1 rounded-lg bg-muted/50 p-1" role="radiogroup" aria-label={`Copione del video ${i + 1}`}>
                      {MODES.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          role="radio"
                          aria-checked={it.mode === m.id}
                          title={m.hint}
                          onClick={() => patch(it.id, { mode: m.id })}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition',
                            it.mode === m.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          <m.icon className="size-3.5" /> {m.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => move(i, -1)} disabled={i === 0 || uploading} aria-label="Sposta su">
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        onClick={() => move(i, 1)}
                        disabled={i === items.length - 1 || uploading}
                        aria-label="Sposta giù"
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8 text-muted-foreground"
                        onClick={() => {
                          URL.revokeObjectURL(it.url);
                          setItems((cur) => cur.filter((x) => x.id !== it.id));
                        }}
                        disabled={uploading}
                        aria-label="Togli il video"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>

                  {it.mode === 'frames' && (
                    <p className="rounded-md bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground">
                      L&apos;AI guarda il video e scrive un copione di circa <strong>{b.target} parole</strong>, tarato sui {fmtTime(duration)} del video. Potrai
                      rivederlo prima di generare le clip.
                    </p>
                  )}
                  {it.mode === 'hint' && (
                    <div className="space-y-1">
                      <textarea
                        value={it.hint}
                        onChange={(e) => patch(it.id, { hint: e.target.value })}
                        rows={2}
                        maxLength={1000}
                        placeholder="Es. Spiega come si indossa il casco e perché va allacciato bene"
                        className="w-full rounded-md border bg-background p-2 text-sm"
                        aria-label={`Indicazione per il video ${i + 1}`}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        L&apos;AI segue la tua indicazione, guarda il video e scrive circa {b.target} parole.
                      </p>
                    </div>
                  )}
                  {it.mode === 'manual' && (
                    <div className="space-y-1.5">
                      <textarea
                        value={it.script}
                        onChange={(e) => patch(it.id, { script: e.target.value })}
                        rows={Math.min(8, Math.max(3, Math.ceil(it.script.length / 80)))}
                        maxLength={4000}
                        placeholder={`Il testo esatto che l’avatar dirà (circa ${b.target} parole)`}
                        className="w-full rounded-md border bg-background p-2 text-sm leading-relaxed"
                        aria-label={`Copione del video ${i + 1}`}
                      />
                      <WordMeter text={it.script} durationSec={duration} />
                    </div>
                  )}

                  <details className="text-xs" open={Boolean(it.trim)}>
                    <summary className="inline-flex cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground">
                      <Scissors className="size-3.5" /> Usa solo un tratto del video
                    </summary>
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      {(['start', 'end'] as const).map((k) => (
                        <label key={k} className="space-y-1">
                          <span className="block text-muted-foreground">{k === 'start' ? 'Da (secondi)' : 'A (secondi)'}</span>
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              min={0}
                              max={it.durationSec}
                              step={0.5}
                              className="h-8 w-24"
                              value={(it.trim ?? { start: 0, end: it.durationSec })[k]}
                              onChange={(e) => {
                                const cur = it.trim ?? { start: 0, end: it.durationSec };
                                const v = Math.min(it.durationSec, Math.max(0, Number(e.target.value) || 0));
                                patch(it.id, { trim: { ...cur, [k]: v } });
                              }}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2"
                              title="Usa il punto in cui è fermo il video qui accanto"
                              onClick={() => {
                                const el = document.getElementById(`vid-${it.id}`) as HTMLVideoElement | null;
                                if (!el) return;
                                const cur = it.trim ?? { start: 0, end: it.durationSec };
                                patch(it.id, { trim: { ...cur, [k]: Math.round(el.currentTime * 10) / 10 } });
                              }}
                            >
                              dal video
                            </Button>
                          </div>
                        </label>
                      ))}
                      {it.trim && (
                        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => patch(it.id, { trim: null })}>
                          Usa tutto il video
                        </Button>
                      )}
                    </div>
                  </details>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {items.length > 0 && (
        <div className="space-y-2">
          {problems.length > 0 && (
            <ul className="list-disc space-y-0.5 rounded-lg border border-amber-300/60 bg-amber-50 py-2 pl-6 pr-3 text-xs text-amber-900">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              {items.length} video · {fmtTime(totalSec)} in tutto
            </span>
            <Button type="button" size="lg" onClick={() => void upload()} disabled={uploading || reading > 0 || problems.length > 0}>
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {uploading ? 'Carico i video…' : 'Carica e continua'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
