'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Clapperboard, FileUp, Wand2 } from 'lucide-react';
import {
  HEYGEN_ENGINES,
  heygenAvatarTypeLabel,
  heygenBillingTypeFor,
  heygenCostPerMinUsd,
  heygenEngineSupports,
} from '@scorm/contracts';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { AiWorking, AiWorkingInline } from '@/components/courses/ai-working';
import type { PipPosition, SlideAvatarType, SlideLayout, SlideScriptEntry, SlideSection, SlideShot } from '@/lib/api/types';
import {
  qk,
  useBuildSlideLesson,
  useGenerateSlideScripts,
  useImportSlides,
  useProposeSlideSections,
  useRemasterSlideLesson,
  useReplaceSlides,
  useKnowledge,
  useSaveSlideScripts,
  useSlideClips,
  useSlideClipsEstimate,
  useSlideDirection,
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
  const replace = useReplaceSlides(courseId, importId);
  const replaceRef = React.useRef<HTMLInputElement>(null);
  const toast = useToast();
  // Errore della sostituzione mostrato in modo persistente (un toast di pochi secondi si perde).
  const [replaceError, setReplaceError] = React.useState<string | null>(null);
  const scripts = useSlideScripts(courseId, importId);
  const clips = useSlideClips(courseId, importId);
  const lesson = useSlideLesson(courseId, importId);

  const scriptsDoc = scripts.data && 'slides' in scripts.data ? scripts.data : null;
  const scriptsGeneration = scripts.data?.generation;
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

  async function handleReplace(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setReplaceError(null);
    try {
      const res = await replace.mutateAsync(file);
      toast.show(
        res.warnings.length > 0
          ? `Slide aggiornate. ${res.warnings[0]}`
          : lessonView?.status === 'completed'
            ? 'Slide aggiornate. Per vederle nei video usa «Aggiorna i video con le nuove slide».'
            : 'Slide aggiornate: copioni e clip sono rimasti invariati',
        res.warnings.length > 0 ? 'info' : 'success',
      );
    } catch (err) {
      setReplaceError(apiErrorMessage(err) || 'Sostituzione del PDF non riuscita');
    }
  }

  return (
    <div className="space-y-8">
      <input ref={replaceRef} type="file" accept="application/pdf" className="hidden" onChange={handleReplace} />
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
        <span className="min-w-0 truncate">
          <strong>{imp.data?.filename ?? 'Slide importate'}</strong>
          {imp.data ? ` · ${imp.data.slides.length} slide` : ''}
        </span>
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={replace.isPending || lessonView?.status === 'running'}
            onClick={() => replaceRef.current?.click()}
            title="Sostituisce solo le immagini delle slide con un PDF aggiornato (stesse pagine). Copioni e clip avatar restano invariati: nessun costo HeyGen."
          >
            {replace.isPending ? <AiWorkingInline label="Aggiorno le slide…" /> : 'Sostituisci con PDF aggiornato'}
          </Button>
          {!lessonView && !clipsView && (
            <Button size="sm" variant="ghost" onClick={onReplace}>
              Nuovo import (azzera tutto)
            </Button>
          )}
        </div>
      </div>
      {replaceError && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <p>
            <strong>PDF non sostituito.</strong> {replaceError}
          </p>
          <Button size="sm" variant="ghost" onClick={() => setReplaceError(null)} aria-label="Chiudi">
            ✕
          </Button>
        </div>
      )}

      <StepScripts
        courseId={courseId}
        importId={importId}
        doc={scriptsDoc}
        generation={scriptsGeneration}
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
          clips={clipsView!}
          thumbs={imp.data?.slides ?? []}
          extraTitles={Object.fromEntries((scriptsDoc?.slides ?? []).filter((x) => x.extra).map((x) => [x.index, x.extra!.title]))}
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
  generation,
  loading,
  thumbs,
  locked,
}: {
  courseId: string;
  importId: string;
  doc: import('@/lib/api/types').SlideScriptsDoc | null;
  generation?: import('@/lib/api/types').SlideScriptsGeneration;
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

  // Notifica una volta sola quando la generazione in background termina.
  const prevGen = React.useRef<string | undefined>(generation?.status);
  React.useEffect(() => {
    if (prevGen.current === 'running' && generation?.status === 'completed') {
      toast.show('Copioni generati: rivedili prima di approvarli', 'success');
    }
    prevGen.current = generation?.status;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation?.status]);

  const thumbByIndex = React.useMemo(() => new Map(thumbs.map((t) => [t.index, t.imageUrl])), [thumbs]);
  const approved = doc?.status === 'approved';
  const generating = generate.isPending || generation?.status === 'running';
  const generationError = generation?.status === 'failed' ? generation.error : undefined;
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
      toast.show('Generazione avviata: prosegue sul server, ci vuole circa un paio di minuti', 'success');
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
          {generationError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              Generazione non riuscita: {generationError}
            </p>
          )}
          {generating && (
            <AiWorking
              label={kbIds.size ? 'Confronto slide e knowledge…' : 'Scrivo i copioni…'}
              hint="Gira sul server e richiede uno o due minuti: puoi chiudere la finestra e tornare più tardi."
            />
          )}
          <Button onClick={handleGenerate} disabled={generating}>
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
          {generating && (
            <AiWorking label="Rigenero i copioni…" hint="Gira sul server: i copioni qui sotto sono quelli precedenti finché non finisce." />
          )}
          {generationError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              Generazione non riuscita: {generationError}
            </p>
          )}
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
                  <Button variant="outline" onClick={handleGenerate} disabled={generating || save.isPending}>
                    {generating ? <AiWorkingInline label="Rigenero…" /> : 'Rigenera tutti'}
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
  // Il tipo (e quindi la tariffa) segue l'avatar scelto: digital twin, da foto o del catalogo.
  React.useEffect(() => {
    if (selected) setAvatarType(heygenBillingTypeFor({ source: selected.source, groupType: selected.groupType }));
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
                    <span className="block truncate px-1 pt-0.5 text-[11px]">{a.name}</span>
                    <span className="block truncate px-1 pb-0.5 text-[10px] text-muted-foreground">
                      {heygenAvatarTypeLabel({ source: a.source, groupType: a.groupType })}
                    </span>
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
              <span className="block text-[11px] text-muted-foreground">Impostato dall&apos;avatar scelto; determina la tariffa HeyGen.</span>
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
  clips,
  thumbs,
  extraTitles,
  defaultTitle,
  onClose,
}: {
  courseId: string;
  importId: string;
  view: import('@/lib/api/types').SlideLessonView | null;
  clips: import('@/lib/api/types').SlideClipsView;
  thumbs: Array<{ index: number; imageUrl: string }>;
  extraTitles: Record<number, string>;
  defaultTitle: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const build = useBuildSlideLesson(courseId, importId);
  const remaster = useRemasterSlideLesson(courseId, importId);
  const propose = useProposeSlideSections(courseId, importId);
  const [layout, setLayout] = React.useState<SlideLayout>(view?.layout ?? 'dynamic');
  const [slideShots, setSlideShots] = React.useState<Record<string, SlideShot>>(view?.slideShots ?? {});
  const [pipPosition, setPipPosition] = React.useState<PipPosition>(view?.pipPosition ?? 'bottom-right');
  const [slidePositions, setSlidePositions] = React.useState<Record<string, PipPosition>>(view?.slidePositions ?? {});
  const [burnCaptions, setBurnCaptions] = React.useState<boolean>(view?.burnCaptions ?? false);
  const [editLayout, setEditLayout] = React.useState(false);
  // Allinea le scelte a quelle salvate quando arriva lo stato dal server.
  React.useEffect(() => {
    if (!view) return;
    setLayout(view.layout);
    setPipPosition(view.pipPosition ?? 'bottom-right');
    setSlidePositions(view.slidePositions ?? {});
    setSlideShots(view.slideShots ?? {});
    setBurnCaptions(view.burnCaptions ?? true);
  }, [view?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const [title, setTitle] = React.useState(defaultTitle);
  const [mode, setMode] = React.useState<'single' | 'sections'>('single');
  const [sections, setSections] = React.useState<SlideSection[]>([]);

  const clipIdx = React.useMemo(() => clips.clips.map((c) => c.index).sort((a, b) => a - b), [clips.clips]);
  const lastIdx = clipIdx[clipIdx.length - 1] ?? 1;
  /** Slide incluse e durata del video per la sezione `i` (fino alla successiva). */
  function sectionStats(i: number): { slides: number; sec: number } {
    const from = sections[i]?.from ?? 1;
    const to = i < sections.length - 1 ? (sections[i + 1]?.from ?? lastIdx + 1) - 1 : Number.MAX_SAFE_INTEGER;
    const inRange = clips.clips.filter((c) => c.index >= from && c.index <= to);
    return { slides: inRange.length, sec: inRange.reduce((n, c) => n + (c.durationSec ?? 0), 0) };
  }
  const sectionsValid =
    sections.length > 0 &&
    sections[0]?.from === 1 &&
    sections.every((s, i) => s.title.trim() && (i === 0 || s.from > sections[i - 1]!.from)) &&
    sections.every((_, i) => sectionStats(i).slides > 0);

  async function handlePropose() {
    try {
      const res = await propose.mutateAsync();
      setSections(res.sections);
    } catch {
      toast.show('Non sono riuscito a proporre le sezioni: aggiungile a mano', 'error');
      setSections([{ title: 'Sezione 1', from: 1 }]);
    }
  }

  function chooseMode(m: 'single' | 'sections') {
    setMode(m);
    if (m === 'sections' && sections.length === 0) void handlePropose();
  }

  async function handleBuild() {
    try {
      await build.mutateAsync({
        layout,
        pipPosition,
        slidePositions: layout === 'split' ? {} : slidePositions,
        slideShots: layout === 'dynamic' ? slideShots : {},
        burnCaptions,
        moduleTitle: title.trim() || undefined,
        sections: mode === 'sections' ? sections.map((s) => ({ title: s.title.trim(), from: s.from })) : undefined,
      });
      toast.show('Montaggio avviato: richiede alcuni minuti', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      toast.show(
        /501|non configurat|CARTOON_LAMBDA/i.test(msg)
          ? 'Render video non configurato sul server'
          : /non contiene slide|inizio diverse|prima sezione/i.test(msg)
            ? 'Sezioni non valide: controlla le slide di inizio'
            : 'Avvio del montaggio non riuscito',
        'error',
      );
    }
  }

  async function handleRemaster() {
    try {
      await remaster.mutateAsync(
        editLayout
          ? {
              layout,
              pipPosition,
              slidePositions: layout === 'split' ? {} : slidePositions,
              slideShots: layout === 'dynamic' ? slideShots : {},
              burnCaptions,
            }
          : undefined,
      );
      setEditLayout(false);
      toast.show('Rimontaggio avviato: le clip avatar non vengono rigenerate', 'success');
    } catch {
      toast.show('Avvio del rimontaggio non riuscito', 'error');
    }
  }

  const STEP_LABEL: Record<string, string> = {
    render: 'Montaggio del video con slide, avatar e sottotitoli…',
    summary: 'Scrivo il riepilogo e i punti chiave…',
    lesson: 'Creo modulo e lezione…',
    quiz: 'Preparo il quiz di verifica…',
    final_quiz: 'Preparo il test finale…',
    done: 'Completato',
  };

  return (
    <section className="space-y-3">
      <Heading n={3} title="Montaggio e lezioni" done={view?.status === 'completed'} />
      {(!view || view.status === 'failed') && (
        <div className="space-y-3">
          {view?.status === 'failed' && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {view.error ?? 'Montaggio non riuscito'} — i passi già completati non verranno rifatti.
            </p>
          )}
          {!view && (
            <>
              <fieldset className="space-y-1 text-sm">
                <legend className="font-medium">Come vuoi organizzare il corso?</legend>
                {([
                  ['single', 'Una sola lezione con tutte le slide (un video, un riepilogo, un quiz)'],
                  ['sections', 'Un modulo per sezione (un video, un riepilogo e un quiz per sezione, più un test finale)'],
                ] as const).map(([id, label]) => (
                  <label key={id} className="flex items-center gap-2">
                    <input type="radio" name="slide-mode" checked={mode === id} onChange={() => chooseMode(id)} />
                    {label}
                  </label>
                ))}
              </fieldset>

              {mode === 'single' ? (
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">Titolo del modulo e della lezione</span>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
                </label>
              ) : (
                <div className="space-y-2">
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium">Titolo del corso (usato nel test finale)</span>
                    <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
                  </label>
                  <p className="text-sm font-medium">Sezioni</p>
                  {propose.isPending ? (
                    <AiWorkingInline label="Propongo le sezioni dalle slide…" />
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Proposte dall&apos;AI leggendo le slide: modifica titoli e slide di inizio come preferisci. Ogni
                        sezione diventa un modulo con il suo video.
                      </p>
                      <ul className="space-y-2">
                        {sections.map((sec, i) => {
                          const st = sectionStats(i);
                          return (
                            <li key={i} className="grid items-center gap-2 rounded-md border p-2 sm:grid-cols-[1fr_110px_auto_auto]">
                              <Input
                                value={sec.title}
                                maxLength={200}
                                onChange={(e) => setSections((cur) => cur.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                              />
                              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                                da slide
                                <input
                                  type="number"
                                  min={1}
                                  max={lastIdx}
                                  value={sec.from}
                                  disabled={i === 0}
                                  className="h-9 w-16 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                                  onChange={(e) => setSections((cur) => cur.map((x, j) => (j === i ? { ...x, from: Number(e.target.value) || 1 } : x)))}
                                />
                              </label>
                              <span className="text-xs text-muted-foreground">
                                {st.slides} slide · {fmtMin(st.sec)}
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={sections.length <= 1}
                                onClick={() => setSections((cur) => cur.filter((_, j) => j !== i))}
                                aria-label="Rimuovi sezione"
                              >
                                ✕
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setSections((cur) => [...cur, { title: `Sezione ${cur.length + 1}`, from: Math.min(lastIdx, (cur[cur.length - 1]?.from ?? 0) + 1) }])
                          }
                        >
                          + Sezione
                        </Button>
                        <Button size="sm" variant="ghost" onClick={handlePropose}>
                          Riproponi
                        </Button>
                      </div>
                      {!sectionsValid && sections.length > 0 && (
                        <p className="text-xs text-destructive">
                          La prima sezione parte dalla slide 1, le slide di inizio devono crescere e ogni sezione deve avere almeno una slide inclusa.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              <LayoutEditor
                layout={layout}
                setLayout={setLayout}
                pipPosition={pipPosition}
                setPipPosition={setPipPosition}
                slidePositions={slidePositions}
                setSlidePositions={setSlidePositions}
                burnCaptions={burnCaptions}
                setBurnCaptions={setBurnCaptions}
                slideShots={slideShots}
                setSlideShots={setSlideShots}
                courseId={courseId}
                importId={importId}
                clipIndexes={clipIdx}
                thumbs={thumbs}
                extraTitles={extraTitles}
              />
            </>
          )}
          <div className="flex justify-end">
            <Button
              onClick={handleBuild}
              disabled={build.isPending || !title.trim() || (!view && mode === 'sections' && !sectionsValid)}
            >
              {build.isPending ? (
                <AiWorkingInline label="Avvio…" />
              ) : (
                <>
                  <Clapperboard className="size-4" />{' '}
                  {view ? 'Riprova il montaggio' : mode === 'sections' ? `Crea ${sections.length} moduli` : 'Crea la video-lezione'}
                </>
              )}
            </Button>
          </div>
        </div>
      )}
      {view?.status === 'running' && (
        <div className="space-y-2">
          <AiWorking
            label={
              (view.remaster ? 'Aggiorno i video con le nuove slide — ' : '') +
              (view.mode === 'sections' && view.step !== 'final_quiz'
                ? `Modulo ${view.currentPart + 1} di ${view.parts.length} — `
                : '') +
              (STEP_LABEL[view.step] ?? 'Elaborazione…')
            }
            hint="Prosegue sul server: puoi chiudere questa finestra e tornare più tardi."
          />
          {view.mode === 'sections' && (
            <ul className="space-y-1 text-sm">
              {view.parts.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className={cn('grid size-4 place-items-center rounded-full text-[10px]', p.done ? 'bg-primary text-primary-foreground' : 'border')}>
                    {p.done ? '✓' : ''}
                  </span>
                  {p.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {view?.status === 'completed' && (
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          <p className="font-medium">
            {view.mode === 'sections'
              ? `${view.parts.length} moduli creati: ${view.parts.map((p) => `«${p.title}»`).join(', ')}.`
              : `La video-lezione «${view.moduleTitle}» è pronta.`}
          </p>
          <p className="text-muted-foreground">
            Trovi {view.mode === 'sections' ? 'i nuovi moduli' : 'il nuovo modulo'} tra i contenuti del corso, con video,
            trascrizione, riepilogo scritto e quiz di verifica
            {view.mode === 'sections' ? ' (più il test finale del corso)' : ''}. I contenuti sono in bozza: vanno
            validati prima della pubblicazione.
          </p>
          <div className="rounded-md border bg-background p-2 text-xs text-muted-foreground">
            Hai sostituito il PDF o vuoi spostare l&apos;avatar? Rimonta i video: si rifà solo il montaggio (pochi
            centesimi), le clip avatar non si rigenerano e riepilogo, trascrizione e quiz restano invariati.
          </div>
          {editLayout && (
            <div className="rounded-md border bg-background p-3">
              <LayoutEditor
                layout={layout}
                setLayout={setLayout}
                pipPosition={pipPosition}
                setPipPosition={setPipPosition}
                slidePositions={slidePositions}
                setSlidePositions={setSlidePositions}
                burnCaptions={burnCaptions}
                setBurnCaptions={setBurnCaptions}
                slideShots={slideShots}
                setSlideShots={setSlideShots}
                courseId={courseId}
                importId={importId}
                clipIndexes={clipIdx}
                thumbs={thumbs}
                extraTitles={extraTitles}
              />
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditLayout((v) => !v)}>
              {editLayout ? 'Annulla modifiche alla disposizione' : 'Cambia disposizione o posizione dell’avatar'}
            </Button>
            <Button variant="outline" onClick={handleRemaster} disabled={remaster.isPending}>
              {remaster.isPending ? (
                <AiWorkingInline label="Avvio…" />
              ) : editLayout ? (
                'Rimonta i video con la nuova disposizione'
              ) : (
                'Aggiorna i video con le nuove slide'
              )}
            </Button>
            <Button onClick={onClose}>Chiudi</Button>
          </div>
        </div>
      )}
    </section>
  );
}

const PIP_POSITIONS: Array<{ id: PipPosition; label: string }> = [
  { id: 'top-left', label: 'In alto a sinistra' },
  { id: 'top-right', label: 'In alto a destra' },
  { id: 'bottom-left', label: 'In basso a sinistra' },
  { id: 'bottom-right', label: 'In basso a destra' },
];

/** Riquadro 16:9 con i quattro angoli selezionabili (posizione del cerchio avatar). */
function CornerPicker({
  value,
  onChange,
  small = false,
  inherit,
}: {
  value: PipPosition | undefined;
  onChange: (p: PipPosition | undefined) => void;
  small?: boolean;
  /** Posizione ereditata dal default, mostrata attenuata quando `value` è vuoto. */
  inherit?: PipPosition;
}) {
  const shown = value ?? inherit;
  return (
    <div className={cn('relative rounded border bg-muted/40', small ? 'h-[54px] w-24' : 'h-24 w-[168px]')}>
      {PIP_POSITIONS.map((p) => {
        const [v, h] = p.id.split('-') as ['top' | 'bottom', 'left' | 'right'];
        const active = shown === p.id;
        return (
          <button
            key={p.id}
            type="button"
            title={p.label}
            aria-label={p.label}
            aria-pressed={value === p.id}
            onClick={() => onChange(value === p.id && inherit ? undefined : p.id)}
            className={cn(
              'absolute grid place-items-center rounded-full border-2 transition',
              small ? 'size-5' : 'size-8',
              v === 'top' ? 'top-1' : 'bottom-1',
              h === 'left' ? 'left-1' : 'right-1',
              active
                ? value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-primary/50 bg-primary/30'
                : 'border-dashed border-muted-foreground/40 bg-background hover:border-primary',
            )}
          />
        );
      })}
    </div>
  );
}

/** Disposizione del video e, nel layout pip, posizione dell'avatar (default + per slide). */
function LayoutEditor({
  layout,
  setLayout,
  pipPosition,
  setPipPosition,
  slidePositions,
  setSlidePositions,
  burnCaptions,
  setBurnCaptions,
  slideShots,
  setSlideShots,
  courseId,
  importId,
  clipIndexes,
  thumbs,
  extraTitles,
}: {
  burnCaptions: boolean;
  setBurnCaptions: (v: boolean) => void;
  slideShots: Record<string, SlideShot>;
  setSlideShots: (fn: (cur: Record<string, SlideShot>) => Record<string, SlideShot>) => void;
  courseId: string;
  importId: string;
  layout: SlideLayout;
  setLayout: (l: SlideLayout) => void;
  pipPosition: PipPosition;
  setPipPosition: (p: PipPosition) => void;
  slidePositions: Record<string, PipPosition>;
  setSlidePositions: (fn: (cur: Record<string, PipPosition>) => Record<string, PipPosition>) => void;
  clipIndexes: number[];
  thumbs: Array<{ index: number; imageUrl: string }>;
  extraTitles: Record<number, string>;
}) {
  const [perSlide, setPerSlide] = React.useState(Object.keys(slidePositions).length > 0);
  const thumbByIndex = React.useMemo(() => new Map(thumbs.map((t) => [t.index, t.imageUrl])), [thumbs]);
  const overrides = Object.keys(slidePositions).length;
  return (
    <div className="space-y-3 text-sm">
      <fieldset className="space-y-1">
        <legend className="font-medium">Disposizione</legend>
        {([
          ['dynamic', 'Dinamica (consigliata): l’inquadratura cambia slide per slide con transizioni animate'],
          ['split', 'Fissa: slide affiancata all’avatar'],
          ['pip', 'Fissa: slide a tutto schermo con l’avatar in un cerchio'],
        ] as const).map(([id, label]) => (
          <label key={id} className="flex items-center gap-2">
            <input type="radio" name="slide-layout" checked={layout === id} onChange={() => setLayout(id)} />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1" checked={burnCaptions} onChange={(e) => setBurnCaptions(e.target.checked)} />
        <span>
          Sottotitoli incisi nel video
          <span className="block text-xs text-muted-foreground">
            Di solito non servono: nella lezione c&apos;è la trascrizione a fianco e il pulsante CC del player mostra i
            sottotitoli quando servono (anche a schermo intero). Attivali solo se il file video verrà usato fuori dal
            corso.
          </span>
        </span>
      </label>
      {layout === 'dynamic' && (
        <DirectionEditor
          courseId={courseId}
          importId={importId}
          clipIndexes={clipIndexes}
          thumbs={thumbs}
          extraTitles={extraTitles}
          slideShots={slideShots}
          setSlideShots={setSlideShots}
          slidePositions={slidePositions}
          setSlidePositions={setSlidePositions}
        />
      )}
      {layout === 'pip' && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-4">
            <CornerPicker value={pipPosition} onChange={(p) => p && setPipPosition(p)} />
            <div className="space-y-1">
              <p className="font-medium">Posizione dell&apos;avatar</p>
              <p className="text-xs text-muted-foreground">
                {PIP_POSITIONS.find((p) => p.id === pipPosition)?.label}: vale per tutte le slide. I sottotitoli si
                spostano per non sovrapporsi all&apos;avatar.
              </p>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={perSlide} onChange={(e) => setPerSlide(e.target.checked)} />
                Scegli la posizione slide per slide{overrides > 0 ? ` (${overrides} personalizzate)` : ''}
              </label>
            </div>
          </div>
          {perSlide && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Clicca un angolo per spostare l&apos;avatar in quella slide; clicca di nuovo per tornare alla posizione
                di default. Utile quando il cerchio coprirebbe una parte importante della slide.
              </p>
              <div className="grid max-h-80 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
                {clipIndexes.map((i) => {
                  const img = thumbByIndex.get(i);
                  return (
                    <div key={i} className="space-y-1 rounded border p-2">
                      <div className="relative">
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element -- URL firmato dinamico
                          <img src={img} alt={`Slide ${i}`} className="w-full rounded" />
                        ) : (
                          <div className="grid aspect-video w-full place-items-center rounded bg-muted p-2 text-center text-[11px]">
                            {extraTitles[i] ?? `Slide ${i}`}
                          </div>
                        )}
                        <AvatarDot pos={slidePositions[String(i)] ?? pipPosition} custom={Boolean(slidePositions[String(i)])} />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">{img ? `Slide ${i}` : 'Slide extra'}</span>
                        <CornerPicker
                          small
                          value={slidePositions[String(i)]}
                          inherit={pipPosition}
                          onChange={(p) =>
                            setSlidePositions((cur) => {
                              const next = { ...cur };
                              if (!p || p === pipPosition) delete next[String(i)];
                              else next[String(i)] = p;
                              return next;
                            })
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SHOTS: Array<{ id: SlideShot; label: string; hint: string }> = [
  { id: 'presenter', label: 'Presentatore', hint: 'avatar grande, slide in una card' },
  { id: 'side', label: 'Affiancata', hint: 'slide grande e avatar a lato' },
  { id: 'focus', label: 'Focus slide', hint: 'slide a tutto schermo, avatar in un cerchio' },
  { id: 'mini', label: 'Avatar discreto', hint: 'slide a tutto schermo, cerchio piccolo' },
];

/**
 * Regia del layout dinamico: per ogni slide l'inquadratura e l'angolo scelti in automatico
 * (in base a ruolo e densità della slide e alla zona più vuota dell'immagine), modificabili.
 */
function DirectionEditor({
  courseId,
  importId,
  clipIndexes,
  thumbs,
  extraTitles,
  slideShots,
  setSlideShots,
  slidePositions,
  setSlidePositions,
}: {
  courseId: string;
  importId: string;
  clipIndexes: number[];
  thumbs: Array<{ index: number; imageUrl: string }>;
  extraTitles: Record<number, string>;
  slideShots: Record<string, SlideShot>;
  setSlideShots: (fn: (cur: Record<string, SlideShot>) => Record<string, SlideShot>) => void;
  slidePositions: Record<string, PipPosition>;
  setSlidePositions: (fn: (cur: Record<string, PipPosition>) => Record<string, PipPosition>) => void;
}) {
  const [open, setOpen] = React.useState(Object.keys(slideShots).length + Object.keys(slidePositions).length > 0);
  const direction = useSlideDirection(courseId, importId, open);
  const auto = React.useMemo(() => new Map((direction.data?.items ?? []).map((d) => [d.index, d])), [direction.data]);
  const thumbByIndex = React.useMemo(() => new Map(thumbs.map((t) => [t.index, t.imageUrl])), [thumbs]);
  const changed = new Set([...Object.keys(slideShots), ...Object.keys(slidePositions)]).size;
  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-xs text-muted-foreground">
        La regia sceglie per ogni slide l&apos;inquadratura (presentatore all&apos;apertura, sulle slide di sezione e in
        chiusura; avatar più discreto sulle slide dense) e mette il cerchio nell&apos;angolo più libero, così non copre il
        contenuto. I colori seguono il brand del corso.
      </p>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
        Rivedi la regia slide per slide{changed > 0 ? ` (${changed} modificate)` : ''}
      </label>
      {open &&
        (direction.isLoading ? (
          <AiWorkingInline label="Analizzo le slide…" />
        ) : (
          <div className="grid max-h-96 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {clipIndexes.map((i) => {
              const key = String(i);
              const a = auto.get(i);
              const shot = slideShots[key] ?? a?.shot ?? 'focus';
              const corner = slidePositions[key] ?? a?.corner ?? 'bottom-right';
              const img = thumbByIndex.get(i);
              const circle = shot === 'focus' || shot === 'mini';
              return (
                <div key={i} className="space-y-1.5 rounded border p-2">
                  <div className="relative overflow-hidden rounded bg-muted">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element -- URL firmato dinamico
                      <img src={img} alt={`Slide ${i}`} className="w-full" />
                    ) : (
                      <div className="grid aspect-video w-full place-items-center p-2 text-center text-[11px]">
                        {extraTitles[i] ?? `Slide ${i}`}
                      </div>
                    )}
                    {circle && <AvatarDot pos={corner} custom={Boolean(slidePositions[key])} small={shot === 'mini'} />}
                    {!circle && (
                      <span className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                        {SHOTS.find((x) => x.id === shot)?.label}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{img ? `Slide ${i}` : 'Slide extra'}</span>
                    {circle && (
                      <CornerPicker
                        small
                        value={slidePositions[key]}
                        inherit={a?.corner ?? 'bottom-right'}
                        onChange={(p) =>
                          setSlidePositions((cur) => {
                            const next = { ...cur };
                            if (!p || p === a?.corner) delete next[key];
                            else next[key] = p;
                            return next;
                          })
                        }
                      />
                    )}
                  </div>
                  <select
                    className={SELECT}
                    value={slideShots[key] ?? ''}
                    title={SHOTS.find((x) => x.id === shot)?.hint}
                    onChange={(e) =>
                      setSlideShots((cur) => {
                        const next = { ...cur };
                        const v = e.target.value as SlideShot | '';
                        if (!v) delete next[key];
                        else next[key] = v;
                        return next;
                      })
                    }
                  >
                    <option value="">Auto · {SHOTS.find((x) => x.id === (a?.shot ?? 'focus'))?.label}</option>
                    {SHOTS.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}

/** Anteprima del cerchio avatar sulla miniatura della slide (stesse proporzioni del video). */
function AvatarDot({ pos, custom, small = false }: { pos: PipPosition; custom: boolean; small?: boolean }) {
  const [v, h] = pos.split('-') as ['top' | 'bottom', 'left' | 'right'];
  return (
    <span
      aria-hidden
      className={cn(
        'absolute aspect-square rounded-full border-2',
        small ? 'w-[10.4%]' : 'w-[15.6%]',
        custom ? 'border-primary bg-primary/60' : 'border-white/80 bg-white/40',
        // Stesse proporzioni del video: cerchio 300 px (margine 44) o 200 px (margine 34) su 1920×1080.
        v === 'top' ? (small ? 'top-[3.1%]' : 'top-[4.1%]') : small ? 'bottom-[3.1%]' : 'bottom-[4.1%]',
        h === 'left' ? (small ? 'left-[1.8%]' : 'left-[2.3%]') : small ? 'right-[1.8%]' : 'right-[2.3%]',
      )}
    />
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

/** Messaggio leggibile da un errore dell'API ("API 400: {json}" oppure testo semplice). */
function apiErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message.replace(/^API \d+:\s*/, '') : '';
  try {
    const parsed = JSON.parse(raw) as { message?: string | string[] };
    const m = Array.isArray(parsed.message) ? parsed.message.join(' ') : parsed.message;
    if (m) return m;
  } catch {
    /* non JSON o troncato */
  }
  const m = /"message"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(raw);
  return (m ? m[1]!.replace(/\\"/g, '"') : raw).slice(0, 400);
}
