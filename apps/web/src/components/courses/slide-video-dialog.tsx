'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Clapperboard, FileUp, Wand2 } from 'lucide-react';
import { HEYGEN_ENGINES, heygenCostPerMinUsd, heygenEngineSupports } from '@scorm/contracts';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { AiWorking, AiWorkingInline } from '@/components/courses/ai-working';
import type { SlideAvatarType, SlideScriptEntry } from '@/lib/api/types';
import {
  qk,
  useBuildSlideLesson,
  useGenerateSlideScripts,
  useImportSlides,
  useKnowledge,
  useSaveSlideScripts,
  useSlideClips,
  useSlideClipsEstimate,
  useSlideImport,
  useSlideLesson,
  useSlideScripts,
  useStartSlideClips,
  useVideoAvatars,
  useVideoVoices,
} from '@/lib/api/hooks';

const TEXTAREA =
  'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-50';
const SELECT =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70';

const AVATAR_TYPES: Array<{ id: SlideAvatarType; label: string }> = [
  { id: 'photo', label: 'Avatar da foto' },
  { id: 'studio', label: 'Avatar del catalogo HeyGen' },
  { id: 'digital_twin', label: 'Digital twin (da video)' },
];

function storageKeyFor(courseId: string) {
  return `slide-video-import:${courseId}`;
}

function fmtMin(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Flusso guidato "video-lezione da slide": PDF → copioni da rivedere → clip con
 * avatar → montaggio con riepilogo e quiz. L'import in corso è ricordato in
 * localStorage, così si può chiudere il dialog e riprendere più tardi.
 */
export function SlideVideoDialog({
  courseId,
  open,
  onClose,
}: {
  courseId: string;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [importId, setImportId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    try {
      setImportId(window.localStorage.getItem(storageKeyFor(courseId)));
    } catch {
      setImportId(null);
    }
  }, [open, courseId]);

  const importSlides = useImportSlides(courseId);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const res = await importSlides.mutateAsync(file);
      window.localStorage.setItem(storageKeyFor(courseId), res.importId);
      setImportId(res.importId);
      toast.show(`${res.slides.length} slide importate`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      toast.show(
        /413|troppo grand/i.test(msg)
          ? 'PDF troppo grande (max 50 MB)'
          : /Troppe pagine|non valido|non leggibile/i.test(msg)
            ? msg.replace(/^API \d+: /, '').slice(0, 160)
            : 'Importazione del PDF non riuscita',
        'error',
      );
    }
  }

  function resetImport() {
    window.localStorage.removeItem(storageKeyFor(courseId));
    setImportId(null);
  }

  return (
    <Dialog open={open} onClose={onClose} title="Video-lezione da slide con avatar" size="xl">
      <div className="max-h-[75vh] space-y-6 overflow-y-auto pr-1">
        <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleFile} />

        {!importId ? (
          <section className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Carica le slide in <strong>PDF</strong> (esportate da PowerPoint con i font incorporati e le
              eventuali slide nascoste incluse). Per ogni slide preparo un copione parlato che potrai rivedere
              prima di generare il video con l&apos;avatar.
            </p>
            <Button onClick={() => fileRef.current?.click()} disabled={importSlides.isPending}>
              {importSlides.isPending ? (
                <AiWorkingInline label="Converto il PDF…" />
              ) : (
                <>
                  <FileUp className="size-4" /> Carica il PDF delle slide
                </>
              )}
            </Button>
          </section>
        ) : (
          <Pipeline
            courseId={courseId}
            importId={importId}
            onReplace={resetImport}
            onLessonDone={() => {
              qc.invalidateQueries({ queryKey: qk.modules(courseId) });
              qc.invalidateQueries({ queryKey: ['courses', courseId, 'assessments'] });
              qc.invalidateQueries({ queryKey: qk.cost(courseId) });
            }}
            onClose={onClose}
          />
        )}
      </div>
    </Dialog>
  );
}

function Pipeline({
  courseId,
  importId,
  onReplace,
  onLessonDone,
  onClose,
}: {
  courseId: string;
  importId: string;
  onReplace: () => void;
  onLessonDone: () => void;
  onClose: () => void;
}) {
  const imp = useSlideImport(courseId, importId);
  const scripts = useSlideScripts(courseId, importId);
  const clips = useSlideClips(courseId, importId);
  const lesson = useSlideLesson(courseId, importId);

  const scriptsDoc = scripts.data && 'slides' in scripts.data ? scripts.data : null;
  const approved = scriptsDoc?.status === 'approved';
  const clipsView = clips.data && 'clips' in clips.data ? clips.data : null;
  const clipsDone = clipsView?.status === 'completed';
  const lessonView = lesson.data && 'step' in lesson.data ? lesson.data : null;

  // Notifica una sola volta il completamento della lezione.
  const notified = React.useRef(false);
  React.useEffect(() => {
    if (lessonView?.status === 'completed' && !notified.current) {
      notified.current = true;
      onLessonDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonView?.status]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
        <span className="min-w-0 truncate">
          <strong>{imp.data?.filename ?? 'Slide importate'}</strong>
          {imp.data ? ` · ${imp.data.slides.length} slide` : ''}
        </span>
        {!lessonView && (
          <Button size="sm" variant="ghost" onClick={onReplace}>
            Usa un altro PDF
          </Button>
        )}
      </div>

      <StepScripts
        courseId={courseId}
        importId={importId}
        doc={scriptsDoc}
        loading={scripts.isLoading}
        thumbs={imp.data?.slides ?? []}
        locked={Boolean(clipsView) && clipsView?.status !== 'failed'}
      />

      {approved && (
        <StepClips courseId={courseId} importId={importId} view={clipsView} />
      )}

      {clipsDone && (
        <StepLesson
          courseId={courseId}
          importId={importId}
          view={lessonView}
          defaultTitle={imp.data?.filename.replace(/\.pdf$/i, '') ?? 'Video-lezione'}
          onClose={onClose}
        />
      )}
    </div>
  );
}

// --- Passo 1: copioni --------------------------------------------------------

function StepScripts({
  courseId,
  importId,
  doc,
  loading,
  thumbs,
  locked,
}: {
  courseId: string;
  importId: string;
  doc: import('@/lib/api/types').SlideScriptsDoc | null;
  loading: boolean;
  thumbs: Array<{ index: number; imageUrl: string }>;
  /** True quando le clip sono già in lavorazione: i copioni non si modificano più. */
  locked: boolean;
}) {
  const toast = useToast();
  const generate = useGenerateSlideScripts(courseId, importId);
  const save = useSaveSlideScripts(courseId, importId);
  const courseDocs = useKnowledge('COURSE', courseId);
  const globalDocs = useKnowledge('GLOBAL');
  const [draft, setDraft] = React.useState<SlideScriptEntry[]>([]);
  const [kbIds, setKbIds] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    if (doc) setDraft(doc.slides.map((s) => ({ ...s })));
  }, [doc?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (doc?.knowledgeDocIds?.length) setKbIds(new Set(doc.knowledgeDocIds));
  }, [doc?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const thumbByIndex = React.useMemo(() => new Map(thumbs.map((t) => [t.index, t.imageUrl])), [thumbs]);
  const approved = doc?.status === 'approved';
  const dirty = doc
    ? JSON.stringify(draft.map((d) => [d.index, d.script, d.skip])) !==
      JSON.stringify(doc.slides.map((d) => [d.index, d.script, d.skip]))
    : false;
  const readyCourse = (courseDocs.data ?? []).filter((d) => d.status === 'READY');
  const readyGlobal = (globalDocs.data ?? []).filter((d) => d.status === 'READY');
  const realSlides = draft.filter((d) => !d.extra);
  const extras = draft.filter((d) => d.extra);

  function toggleKb(id: string) {
    setKbIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else if (next.size < 10) next.add(id);
      return next;
    });
  }

  async function handleGenerate() {
    try {
      await generate.mutateAsync([...kbIds]);
      toast.show('Copioni generati: rivedili prima di approvarli', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      toast.show(
        /409/.test(msg)
          ? 'I copioni sono già approvati: riapri la revisione per rigenerarli'
          : /troppo lunga/i.test(msg)
            ? 'Knowledge troppo lunga: crea prima una «knowledge strutturata» e usa quella'
            : /non ancora pronti/i.test(msg)
              ? 'Alcuni documenti di knowledge non sono ancora pronti'
              : 'Generazione dei copioni non riuscita',
        'error',
      );
    }
  }

  async function handleSave(approve: boolean) {
    try {
      await save.mutateAsync({
        slides: draft.map((d) => ({ index: d.index, script: d.script, skip: d.skip })),
        approved: approve,
      });
      toast.show(approve ? 'Copioni approvati' : 'Bozza salvata', 'success');
    } catch (err) {
      toast.show(
        err instanceof Error && /Copione vuoto/i.test(err.message)
          ? 'Ci sono slide senza copione: compilale o escludile'
          : 'Salvataggio non riuscito',
        'error',
      );
    }
  }

  function patch(index: number, change: Partial<SlideScriptEntry>) {
    setDraft((cur) => cur.map((x) => (x.index === index ? { ...x, ...change } : x)));
  }

  const totalSec = draft.filter((d) => !d.skip).reduce((n, d) => n + d.estSec, 0);
  const totalWords = draft.filter((d) => !d.skip).reduce((n, d) => n + d.words, 0);
  const kbPicker = (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-sm font-medium">Knowledge (facoltativa)</p>
      <p className="text-xs text-muted-foreground">
        Se scegli dei documenti, i copioni confrontano slide e knowledge: spiegano ogni slide con i contenuti
        pertinenti, segnalano le contraddizioni (nel parlato prevale la slide) e mettono da parte gli argomenti che
        nessuna slide copre. Il parlato risulta più lungo: durata e costo si vedono nel passo 2.
      </p>
      {readyCourse.length + readyGlobal.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nessun documento pronto. Caricali dalla pagina Knowledge.</p>
      ) : (
        <div className="max-h-44 space-y-2 overflow-y-auto">
          {[
            ['Fonti del corso', readyCourse],
            ['Knowledge globale', readyGlobal],
          ].map(([label, list]) =>
            (list as typeof readyCourse).length === 0 ? null : (
              <div key={label as string}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label as string}</p>
                <ul>
                  {(list as typeof readyCourse).map((d) => (
                    <li key={d.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent/30">
                        <input type="checkbox" checked={kbIds.has(d.id)} onChange={() => toggleKb(d.id)} />
                        <span className="truncate">{d.filename}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );

  return (
    <section className="space-y-3">
      <Heading n={1} title="Copioni" done={approved} />
      {loading && <Skeleton className="h-20 w-full" />}
      {!loading && !doc && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Scrivo per ogni slide il testo che l&apos;avatar pronuncerà. Poi lo rivedi e lo approvi: le clip (a
            pagamento) partono solo dopo la tua approvazione. Ogni slide resta a schermo finché l&apos;avatar non ha
            finito di parlare.
          </p>
          {kbPicker}
          <Button onClick={handleGenerate} disabled={generate.isPending}>
            {generate.isPending ? (
              <AiWorkingInline label={kbIds.size ? 'Confronto slide e knowledge…' : 'Scrivo i copioni…'} />
            ) : (
              <>
                <Wand2 className="size-4" /> Genera i copioni{kbIds.size ? ` con ${kbIds.size} documento/i di knowledge` : ''}
              </>
            )}
          </Button>
        </div>
      )}
      {doc && (
        <>
          <p className="text-xs text-muted-foreground">
            {draft.filter((d) => !d.skip).length} slide incluse · {totalWords} parole · circa {fmtMin(totalSec)} di parlato.
            {doc.knowledgeNames?.length ? ` Knowledge usata: ${doc.knowledgeNames.join(', ')}.` : ''}
            {approved
              ? ' Copioni approvati.'
              : ' Controlla soprattutto che nulla sia stato aggiunto o cambiato rispetto alle slide.'}
          </p>
          {!approved && !locked && kbPicker}
          <ul className="space-y-3">
            {realSlides.map((d) => (
              <li key={d.index} className={cn('grid gap-3 rounded-lg border p-3 sm:grid-cols-[180px_1fr]', d.skip && 'opacity-60')}>
                <div className="space-y-1">
                  {thumbByIndex.get(d.index) && (
                    // eslint-disable-next-line @next/next/no-img-element -- URL firmato dinamico
                    <img src={thumbByIndex.get(d.index)} alt={`Slide ${d.index}`} className="w-full rounded border" />
                  )}
                  <p className="text-xs text-muted-foreground">
                    Slide {d.index}
                    {d.usedKnowledge ? ' · arricchita dalla knowledge' : ''}
                  </p>
                </div>
                <div className="space-y-2">
                  {d.conflicts && d.conflicts.length > 0 && (
                    <div className="rounded-md border border-amber-300/60 bg-amber-50 p-2 text-xs text-amber-900">
                      <p className="font-semibold">Contraddizione tra slide e knowledge (nel copione prevale la slide):</p>
                      <ul className="list-disc pl-4">
                        {d.conflicts.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <textarea
                    className={TEXTAREA}
                    rows={d.words > 120 ? 8 : 4}
                    value={d.script}
                    maxLength={4000}
                    disabled={approved || locked || d.skip}
                    onChange={(e) =>
                      patch(d.index, { script: e.target.value, words: e.target.value.split(/\s+/).filter(Boolean).length })
                    }
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={d.skip}
                        disabled={approved || locked}
                        onChange={(e) => patch(d.index, { skip: e.target.checked })}
                      />
                      Escludi questa slide dal video
                    </label>
                    <span>{d.words} parole</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {extras.length > 0 && (
            <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="text-sm font-medium">Argomenti della knowledge non coperti dalle slide</p>
              <p className="text-xs text-muted-foreground">
                Di default finiscono nella parte scritta della lezione («Approfondimenti»). Spunta quelli che vuoi
                far raccontare dall&apos;avatar come slide aggiuntiva: aggiungono minuti di video e quindi costo.
              </p>
              <ul className="space-y-3">
                {extras.map((d) => (
                  <li key={d.index} className="space-y-2 rounded-md border bg-background p-3">
                    <p className="text-sm font-medium">{d.extra?.title}</p>
                    <p className="text-xs text-muted-foreground">{d.extra?.summary}</p>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={!d.skip}
                        disabled={approved || locked}
                        onChange={(e) => patch(d.index, { skip: !e.target.checked })}
                      />
                      Aggiungi come slide narrata ({d.words} parole, circa {fmtMin(d.estSec)})
                    </label>
                    {!d.skip && (
                      <textarea
                        className={TEXTAREA}
                        rows={5}
                        value={d.script}
                        maxLength={4000}
                        disabled={approved || locked}
                        onChange={(e) =>
                          patch(d.index, { script: e.target.value, words: e.target.value.split(/\s+/).filter(Boolean).length })
                        }
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!locked && (
            <div className="flex flex-wrap justify-end gap-2">
              {approved ? (
                <Button variant="outline" onClick={() => handleSave(false)} disabled={save.isPending}>
                  Riapri la revisione
                </Button>
              ) : (
                <>
                  <Button variant="outline" onClick={handleGenerate} disabled={generate.isPending || save.isPending}>
                    {generate.isPending ? <AiWorkingInline label="Rigenero…" /> : 'Rigenera tutti'}
                  </Button>
                  <Button variant="outline" onClick={() => handleSave(false)} disabled={!dirty || save.isPending}>
                    Salva bozza
                  </Button>
                  <Button onClick={() => handleSave(true)} disabled={save.isPending}>
                    <Check className="size-4" /> Approva i copioni
                  </Button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// --- Passo 2: avatar e clip --------------------------------------------------

function StepClips({
  courseId,
  importId,
  view,
}: {
  courseId: string;
  importId: string;
  view: import('@/lib/api/types').SlideClipsView | null;
}) {
  const toast = useToast();
  const start = useStartSlideClips(courseId, importId);
  const [source, setSource] = React.useState<'mine' | 'stock'>('mine');
  const [avatarId, setAvatarId] = React.useState('');
  const [avatarType, setAvatarType] = React.useState<SlideAvatarType>('digital_twin');
  const [voiceId, setVoiceId] = React.useState('');
  const [engine, setEngine] = React.useState<'avatar_iii' | 'avatar_iv' | 'avatar_v'>('avatar_iii');

  const started = Boolean(view);
  const avatars = useVideoAvatars(courseId, !started, { source });
  const voices = useVideoVoices(courseId, !started);
  const avatarItems = React.useMemo(() => avatars.data?.pages.flatMap((p) => p.items) ?? [], [avatars.data]);
  const voiceItems = React.useMemo(() => voices.data?.pages.flatMap((p) => p.items) ?? [], [voices.data]);

  // Engine coerente con il tipo di avatar scelto.
  React.useEffect(() => {
    if (!heygenEngineSupports(engine, avatarType)) setEngine('avatar_iii');
  }, [avatarType, engine]);

  const estimate = useSlideClipsEstimate(courseId, importId, engine, avatarType, !started);
  const selected = avatarItems.find((a) => a.id === avatarId);

  async function handleStart() {
    try {
      await start.mutateAsync({ avatarId, avatarType, engine, voiceId: voiceId || undefined });
      toast.show('Generazione delle clip avviata: prosegue sul server', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      toast.show(
        /501|non configurat/i.test(msg)
          ? 'Generazione video non configurata sul server (HeyGen)'
          : /oltre il tetto/i.test(msg)
            ? msg.replace(/^API \d+: /, '').replace(/[{}"]|message:|error:.*$/g, '').slice(0, 160)
            : 'Avvio della generazione non riuscito',
        'error',
      );
    }
  }

  return (
    <section className="space-y-3">
      <Heading n={2} title="Avatar e clip" done={view?.status === 'completed'} />

      {!started && (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Avatar</p>
              <div className="flex gap-1 text-xs">
                {(['mine', 'stock'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setSource(s);
                      setAvatarId('');
                      setAvatarType(s === 'mine' ? 'photo' : 'studio');
                    }}
                    className={cn('rounded-md border px-2 py-1', source === s ? 'border-primary bg-accent/50' : 'hover:bg-accent/30')}
                  >
                    {s === 'mine' ? 'I miei' : 'Catalogo HeyGen'}
                  </button>
                ))}
              </div>
            </div>
            {avatars.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : avatarItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessun avatar disponibile.</p>
            ) : (
              <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto rounded-lg border p-2 sm:grid-cols-5">
                {avatarItems.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAvatarId(a.id)}
                    className={cn('relative overflow-hidden rounded-md border text-left', avatarId === a.id && 'border-primary ring-2 ring-primary/40')}
                    title={a.name}
                  >
                    {a.previewUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- anteprima remota
                      <img src={a.previewUrl} alt="" className="aspect-square w-full object-cover" />
                    )}
                    <span className="block truncate px-1 py-0.5 text-[11px]">{a.name}</span>
                    {avatarId === a.id && <Check className="absolute right-1 top-1 size-4 rounded-full bg-primary p-0.5 text-primary-foreground" />}
                  </button>
                ))}
              </div>
            )}
            {avatars.hasNextPage && (
              <Button size="sm" variant="ghost" onClick={() => avatars.fetchNextPage()} disabled={avatars.isFetchingNextPage}>
                Carica altri avatar
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Tipo di avatar</span>
              <select className={SELECT} value={avatarType} onChange={(e) => setAvatarType(e.target.value as SlideAvatarType)}>
                {AVATAR_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
              <span className="block text-[11px] text-muted-foreground">Determina la tariffa HeyGen.</span>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Qualità (engine)</span>
              <select className={SELECT} value={engine} onChange={(e) => setEngine(e.target.value as typeof engine)}>
                {HEYGEN_ENGINES.filter((e) => heygenEngineSupports(e.id, avatarType)).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label} · ${heygenCostPerMinUsd(e.id, avatarType).toFixed(2)}/min
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Voce</span>
              <select className={SELECT} value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                <option value="">Voce predefinita dell&apos;avatar</option>
                {voiceItems.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}{v.gender ? ` · ${v.gender}` : ''}
                  </option>
                ))}
              </select>
              <span className="block text-[11px] text-muted-foreground">Se l&apos;avatar non ha una voce, scegline una italiana.</span>
            </label>
          </div>

          <div className="rounded-lg border bg-accent/30 p-3 text-sm">
            {estimate.isLoading ? (
              <Skeleton className="h-5 w-48" />
            ) : estimate.data ? (
              <>
                <p>
                  <strong>{estimate.data.slides}</strong> clip · circa <strong>{estimate.data.minutes} min</strong> di video ·
                  costo HeyGen stimato <strong>${estimate.data.costUsd.toFixed(2)}</strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  Tetto per esecuzione: {estimate.data.maxMinutes} min. Il costo reale dipende dalla durata effettiva delle clip.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">Stima non disponibile.</p>
            )}
          </div>

          <div className="flex justify-end">
            <Button onClick={handleStart} disabled={!avatarId || start.isPending}>
              {start.isPending ? (
                <AiWorkingInline label="Avvio…" />
              ) : (
                <>
                  <Clapperboard className="size-4" /> Genera le clip{selected ? ` con ${selected.name}` : ''}
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {view && <ClipsProgress view={view} onRetry={() => start.mutate({ avatarId: view.avatarId, avatarType: view.avatarType })} retrying={start.isPending} />}
    </section>
  );
}

function ClipsProgress({
  view,
  onRetry,
  retrying,
}: {
  view: import('@/lib/api/types').SlideClipsView;
  onRetry: () => void;
  retrying: boolean;
}) {
  const { total, completed, failed } = view.progress;
  const pct = total ? Math.round((completed / total) * 100) : 0;
  const firstError = view.clips.find((c) => c.error)?.error;
  return (
    <div className="space-y-2">
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn('h-full rounded-full transition-all', failed ? 'bg-destructive' : 'bg-primary')} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm">
        {view.status === 'running' && `Clip pronte: ${completed}/${total}. Prosegue sul server anche se chiudi questa finestra.`}
        {view.status === 'completed' && `Tutte le ${total} clip sono pronte (${fmtMin(view.totalDurationSec)} di video).`}
        {view.status === 'failed' && `${failed} clip non riuscite su ${total}.`}
      </p>
      {view.status === 'running' && <AiWorking label="HeyGen sta generando le clip…" hint="Ogni clip richiede alcuni minuti: le slide vengono elaborate in parallelo." />}
      {view.status === 'failed' && (
        <div className="space-y-2">
          {firstError && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{firstError}</p>}
          <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
            Riprova le clip fallite
          </Button>
        </div>
      )}
    </div>
  );
}

// --- Passo 3: montaggio e lezione -------------------------------------------

function StepLesson({
  courseId,
  importId,
  view,
  defaultTitle,
  onClose,
}: {
  courseId: string;
  importId: string;
  view: import('@/lib/api/types').SlideLessonView | null;
  defaultTitle: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const build = useBuildSlideLesson(courseId, importId);
  const [layout, setLayout] = React.useState<'split' | 'pip'>('split');
  const [title, setTitle] = React.useState(defaultTitle);

  async function handleBuild() {
    try {
      await build.mutateAsync({ layout, moduleTitle: title.trim() || undefined });
      toast.show('Montaggio avviato: richiede alcuni minuti', 'success');
    } catch (err) {
      toast.show(
        err instanceof Error && /501|non configurat|CARTOON_LAMBDA/i.test(err.message)
          ? 'Render video non configurato sul server'
          : 'Avvio del montaggio non riuscito',
        'error',
      );
    }
  }

  const STEP_LABEL: Record<string, string> = {
    render: 'Montaggio del video con slide, avatar e sottotitoli…',
    summary: 'Scrivo il riepilogo e i punti chiave…',
    lesson: 'Creo modulo e lezione…',
    quiz: 'Preparo il quiz di verifica…',
    done: 'Completato',
  };

  return (
    <section className="space-y-3">
      <Heading n={3} title="Montaggio e lezione" done={view?.status === 'completed'} />
      {(!view || view.status === 'failed') && (
        <div className="space-y-3">
          {view?.status === 'failed' && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {view.error ?? 'Montaggio non riuscito'} — i passi già completati non verranno rifatti.
            </p>
          )}
          {!view && (
            <>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Titolo del modulo e della lezione</span>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
              </label>
              <fieldset className="space-y-1 text-sm">
                <legend className="font-medium">Disposizione</legend>
                {([
                  ['split', 'Slide affiancata all’avatar (consigliata: non copre le slide)'],
                  ['pip', 'Slide a tutto schermo con l’avatar in un cerchio'],
                ] as const).map(([id, label]) => (
                  <label key={id} className="flex items-center gap-2">
                    <input type="radio" name="slide-layout" checked={layout === id} onChange={() => setLayout(id)} />
                    {label}
                  </label>
                ))}
              </fieldset>
            </>
          )}
          <div className="flex justify-end">
            <Button onClick={handleBuild} disabled={build.isPending || !title.trim()}>
              {build.isPending ? <AiWorkingInline label="Avvio…" /> : (<><Clapperboard className="size-4" /> {view ? 'Riprova il montaggio' : 'Crea la video-lezione'}</>)}
            </Button>
          </div>
        </div>
      )}
      {view?.status === 'running' && <AiWorking label={STEP_LABEL[view.step] ?? 'Elaborazione…'} hint="Prosegue sul server: puoi chiudere questa finestra e tornare più tardi." />}
      {view?.status === 'completed' && (
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          <p className="font-medium">La video-lezione «{view.moduleTitle}» è pronta.</p>
          <p className="text-muted-foreground">
            Trovi il nuovo modulo tra i contenuti del corso, con video, trascrizione, riepilogo scritto e quiz di
            verifica. I contenuti sono in bozza: vanno validati prima della pubblicazione.
          </p>
          <div className="flex justify-end">
            <Button onClick={onClose}>Chiudi</Button>
          </div>
        </div>
      )}
    </section>
  );
}

function Heading({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return (
    <h3 className="flex items-center gap-2 text-base font-semibold">
      <span
        className={cn(
          'grid size-6 place-items-center rounded-full text-xs',
          done ? 'bg-primary text-primary-foreground' : 'border text-muted-foreground',
        )}
      >
        {done ? <Check className="size-3.5" /> : n}
      </span>
      {title}
    </h3>
  );
}
