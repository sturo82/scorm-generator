'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Trash2,
  Loader2,
  Info,
  ChevronDown,
  Globe,
  Eye,
  FileText,
  FolderOpen,
  Wand2,
} from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dropzone } from '@/components/knowledge/dropzone';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import type { LessonFormatValue, RssPreviewResult } from '@/lib/api/types';
import {
  useCreateCourseFromRss,
  useRssPreview,
  useKnowledgePreview,
  useCreateCourseFromKnowledge,
  useKnowledge,
  useUploadKnowledge,
} from '@/lib/api/hooks';

const LANGUAGES = [
  { value: 'it', label: 'Italiano' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
];

/** Formati accettati per l'upload knowledge inline (coerente con /knowledge). */
const KNOWLEDGE_ACCEPT =
  '.pdf,.docx,.pptx,.xlsx,.txt,.md,.html,.csv,application/pdf,text/plain,text/markdown,text/html,text/csv';

type Origin = 'topic' | 'material';
type Source = 'everywhere' | 'mine';

const FORMAT_OPTIONS: Array<{ value: LessonFormatValue; label: string; hint: string }> = [
  { value: 'standard', label: 'Standard', hint: 'Testo, immagini e interazioni. Studio anche senza audio/video.' },
  { value: 'video_first', label: 'Video-first', hint: 'Lezione incentrata su un video portante con capitoli e verifiche.' },
  { value: 'pillola', label: 'Pillola', hint: 'Micro-lezione 2-4 min su un concetto, con mini-video di aggancio.' },
];

const STEPS = ['Sorgente', 'Dettagli', 'Formato', 'Crea'];

export default function NewCoursePage() {
  const router = useRouter();
  const toast = useToast();

  // Hooks API dei due rami + preview.
  const createRss = useCreateCourseFromRss();
  const previewRss = useRssPreview();
  const previewKnow = useKnowledgePreview();
  const createKnow = useCreateCourseFromKnowledge();
  const globalDocs = useKnowledge('GLOBAL');
  const uploadKnowledge = useUploadKnowledge();

  // Stato wizard.
  const [step, setStep] = React.useState(0);
  const [origin, setOrigin] = React.useState<Origin | null>(null);

  // Campi comuni.
  const [title, setTitle] = React.useState('');
  const [language, setLanguage] = React.useState('it');
  const [audience, setAudience] = React.useState('');
  const [tone, setTone] = React.useState('');
  const [scope, setScope] = React.useState('');

  // Ramo "argomento".
  const [topic, setTopic] = React.useState('');
  const [source, setSource] = React.useState<Source>('everywhere');
  const [maxArticles, setMaxArticles] = React.useState(12);
  const [advanced, setAdvanced] = React.useState(false);

  // Ramo "materiale mio".
  const [selectedDocs, setSelectedDocs] = React.useState<string[]>([]);
  const [pendingUploads, setPendingUploads] = React.useState<string[]>([]);

  // Anteprima + formato.
  const [preview, setPreview] = React.useState<RssPreviewResult | null>(null);
  const [editedLessons, setEditedLessons] = React.useState<string[]>([]);
  const [formatDefault, setFormatDefault] = React.useState<LessonFormatValue>('standard');
  // Eccezioni di formato per indice di lezione (mappate a titolo al submit).
  const [lessonFormats, setLessonFormats] = React.useState<Record<number, LessonFormatValue>>({});

  const readyDocs = React.useMemo(
    () => (globalDocs.data ?? []).filter((d) => d.status === 'READY'),
    [globalDocs.data],
  );

  // Auto-seleziona i documenti caricati inline appena diventano READY.
  React.useEffect(() => {
    if (pendingUploads.length === 0) return;
    const readyIds = new Set(readyDocs.map((d) => d.id));
    const nowReady = pendingUploads.filter((id) => readyIds.has(id));
    if (nowReady.length === 0) return;
    setSelectedDocs((prev) => [...new Set([...prev, ...nowReady])]);
    setPendingUploads((prev) => prev.filter((id) => !readyIds.has(id)));
  }, [readyDocs, pendingUploads]);

  const busyPreview = previewRss.isPending || previewKnow.isPending;
  const busyCreate = createRss.isPending || createKnow.isPending;

  function invalidatePreview() {
    if (preview) {
      setPreview(null);
      setEditedLessons([]);
      setLessonFormats({});
    }
  }

  async function handleUploadFiles(files: File[]) {
    for (const file of files) {
      try {
        const doc = await uploadKnowledge.mutateAsync({ file, scope: 'GLOBAL' });
        setPendingUploads((prev) => [...new Set([...prev, doc.id])]);
        toast.show(`"${file.name}" caricato, elaborazione in corso…`, 'success');
      } catch (err) {
        toast.show(err instanceof Error ? err.message : 'Upload non riuscito', 'error');
      }
    }
  }

  // --- Anteprima -------------------------------------------------------------
  async function handlePreview() {
    try {
      let res: RssPreviewResult;
      if (origin === 'topic') {
        if (topic.trim().length < 2) {
          toast.show('Scrivi l’argomento del corso', 'error');
          return;
        }
        res = await previewRss.mutateAsync({
          topic: topic.trim(),
          language,
          source,
          audience: audience.trim() || undefined,
          tone: tone.trim() || undefined,
          scope: scope.trim() || undefined,
        });
      } else {
        if (selectedDocs.length === 0) {
          toast.show('Seleziona almeno un documento', 'error');
          return;
        }
        res = await previewKnow.mutateAsync({
          documentIds: selectedDocs,
          language,
          topic: title.trim() || undefined,
          audience: audience.trim() || undefined,
          tone: tone.trim() || undefined,
          scope: scope.trim() || undefined,
        });
      }
      if (!title.trim() && res.proposedTitle) setTitle(res.proposedTitle);
      if (!audience.trim() && res.proposedAudience) setAudience(res.proposedAudience);
      if (!tone.trim() && res.proposedTone) setTone(res.proposedTone);
      if (!scope.trim() && res.proposedScope) setScope(res.proposedScope);
      setPreview(res);
      setEditedLessons(res.suggestedLessons ?? []);
      setLessonFormats({});
    } catch (err) {
      const msg = err instanceof Error ? err.message.replace(/^API \d+:\s*/, '') : '';
      toast.show(msg || 'Anteprima non riuscita', 'error');
    }
  }

  // --- Crea ------------------------------------------------------------------
  async function handleCreate() {
    // Mappa le eccezioni di formato (per indice) a { titolo: formato }.
    const hints: Record<string, LessonFormatValue> = {};
    editedLessons.forEach((l, i) => {
      const title0 = l.trim();
      const fmt = lessonFormats[i];
      if (title0 && fmt && fmt !== formatDefault) hints[title0] = fmt;
    });
    const frozen: RssPreviewResult | undefined = preview
      ? {
          ...preview,
          suggestedLessons: editedLessons.map((l) => l.trim()).filter((l) => l.length > 0),
          proposedScope: scope.trim() || preview.proposedScope,
          proposedAudience: audience.trim() || preview.proposedAudience,
          proposedTone: tone.trim() || preview.proposedTone,
        }
      : undefined;

    try {
      let courseId: string;
      if (origin === 'topic') {
        const res = await createRss.mutateAsync({
          topic: topic.trim(),
          title: title.trim() || undefined,
          language,
          source,
          audience: audience.trim() || undefined,
          tone: tone.trim() || undefined,
          scope: scope.trim() || undefined,
          preview: frozen,
          maxArticles,
          lessonFormatDefault: formatDefault,
          lessonFormatHints: Object.keys(hints).length > 0 ? hints : undefined,
        });
        courseId = res.courseId;
      } else {
        const res = await createKnow.mutateAsync({
          documentIds: selectedDocs,
          language,
          topic: title.trim() || undefined,
          title: title.trim() || undefined,
          audience: audience.trim() || undefined,
          tone: tone.trim() || undefined,
          scope: scope.trim() || undefined,
          preview: frozen,
          lessonFormatDefault: formatDefault,
          lessonFormatHints: Object.keys(hints).length > 0 ? hints : undefined,
        });
        courseId = res.courseId;
      }
      toast.show('Corso creato: continua con la struttura', 'success');
      router.push(`/courses/${courseId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message.replace(/^API \d+:\s*/, '') : '';
      toast.show(msg || 'Creazione non riuscita', 'error');
    }
  }

  // Avanzamento consentito per step.
  const canLeaveSource = origin !== null;
  const canLeaveDetails =
    origin === 'topic' ? topic.trim().length >= 2 : selectedDocs.length > 0;

  return (
    <>
      <PageHeader
        title="Nuovo corso"
        description="Parti da un argomento o dal tuo materiale: prepariamo struttura e brief, poi scegli il formato di ogni lezione."
      />

      <div className="mx-auto max-w-2xl">
        {/* Stepper */}
        <ol className="mb-6 flex items-center gap-2 text-sm">
          {STEPS.map((label, i) => (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold',
                  i <= step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                {i + 1}
              </span>
              <span className={cn('hidden sm:inline', i === step ? 'font-medium' : 'text-muted-foreground')}>
                {label}
              </span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" />}
            </li>
          ))}
        </ol>

        <Card>
          <CardContent className="flex flex-col gap-6 pt-6">
            {/* STEP 1 — Sorgente */}
            {step === 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <OriginCard
                  active={origin === 'topic'}
                  icon={<Globe className="size-5" />}
                  title="Da un argomento"
                  desc="Scrivi di cosa parla: cerchiamo le fonti migliori e prepariamo il corso."
                  onClick={() => setOrigin('topic')}
                />
                <OriginCard
                  active={origin === 'material'}
                  icon={<FolderOpen className="size-5" />}
                  title="Dal mio materiale"
                  desc="Usa i documenti della tua Knowledge (o caricane di nuovi) come fonti."
                  onClick={() => setOrigin('material')}
                />
              </div>
            )}

            {/* STEP 2 — Dettagli + anteprima */}
            {step === 1 && (
              <div className="flex flex-col gap-5">
                {origin === 'topic' ? (
                  <div className="space-y-2">
                    <Label htmlFor="topic" className="text-base">Di cosa parla il corso?</Label>
                    <Input
                      id="topic"
                      value={topic}
                      maxLength={300}
                      autoFocus
                      className="h-12 text-base"
                      placeholder="Es. sicurezza informatica per neoassunti"
                      onChange={(e) => {
                        setTopic(e.target.value);
                        invalidatePreview();
                      }}
                    />
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Globe className="size-3.5" aria-hidden />
                      Cerchiamo su Google News, testate autorevoli, Wikipedia e materiali didattici aperti.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Label className="text-base">Scegli i documenti</Label>
                    {readyDocs.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nessun documento pronto nella Knowledge globale. Caricane uno qui sotto.
                      </p>
                    ) : (
                      <div className="flex max-h-56 flex-col gap-2 overflow-auto rounded-lg border p-2">
                        {readyDocs.map((d) => {
                          const checked = selectedDocs.includes(d.id);
                          return (
                            <label
                              key={d.id}
                              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50"
                            >
                              <input
                                type="checkbox"
                                className="size-4 accent-[hsl(var(--primary))]"
                                checked={checked}
                                onChange={(e) => {
                                  setSelectedDocs((prev) =>
                                    e.target.checked ? [...prev, d.id] : prev.filter((x) => x !== d.id),
                                  );
                                  invalidatePreview();
                                }}
                              />
                              <FileText className="size-4 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 truncate">{d.filename}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    <Dropzone onFiles={handleUploadFiles} accept={KNOWLEDGE_ACCEPT} disabled={uploadKnowledge.isPending} />
                    {pendingUploads.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {pendingUploads.length} documento{pendingUploads.length === 1 ? '' : 'i'} in elaborazione: verrà selezionato appena pronto.
                      </p>
                    )}
                  </div>
                )}

                {/* Campi comuni (opzionali) */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="audience">A chi è rivolto? <span className="font-normal text-muted-foreground">(opz.)</span></Label>
                    <Input id="audience" value={audience} maxLength={1000} placeholder="Es. neoassunti" onChange={(e) => setAudience(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tone">Tono di voce <span className="font-normal text-muted-foreground">(opz.)</span></Label>
                    <Input id="tone" value={tone} maxLength={1000} placeholder="Es. professionale ma accessibile" onChange={(e) => setTone(e.target.value)} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="scope">Taglio del corso <span className="font-normal text-muted-foreground">(opz.)</span></Label>
                    <Input id="scope" value={scope} maxLength={2000} placeholder="Es. pratico: come applicare, senza fondamenti teorici" onChange={(e) => setScope(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lang">Lingua</Label>
                    <Select id="lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
                      {LANGUAGES.map((l) => (
                        <option key={l.value} value={l.value}>{l.label}</option>
                      ))}
                    </Select>
                  </div>
                </div>

                {/* Opzioni avanzate del ramo argomento */}
                {origin === 'topic' && (
                  <div className="border-t pt-2">
                    <button
                      type="button"
                      onClick={() => setAdvanced((v) => !v)}
                      aria-expanded={advanced}
                      className="flex w-full items-center justify-between py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Opzioni avanzate
                      <ChevronDown className={cn('size-4 transition-transform', advanced && 'rotate-180')} />
                    </button>
                    {advanced && (
                      <div className="grid gap-4 pt-2 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="title">Titolo <span className="font-normal text-muted-foreground">(opz.)</span></Label>
                          <Input id="title" value={title} maxLength={200} placeholder="Lascia vuoto per usare l'argomento" onChange={(e) => setTitle(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="maxart">N. fonti</Label>
                          <Input id="maxart" type="number" min={1} max={25} value={maxArticles} onChange={(e) => setMaxArticles(Math.max(1, Math.min(25, Number(e.target.value) || 12)))} />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label>Dove cercare</Label>
                          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Sorgente">
                            {([['everywhere', 'Ovunque (consigliato)'], ['mine', 'Solo i miei feed']] as Array<[Source, string]>).map(([val, label]) => (
                              <button
                                key={val}
                                type="button"
                                role="radio"
                                aria-checked={source === val}
                                onClick={() => setSource(val)}
                                className={cn(
                                  'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                                  source === val ? 'border-primary bg-primary/10 text-primary' : 'border-input text-muted-foreground hover:bg-accent/60',
                                )}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Anteprima */}
                <div>
                  <Button type="button" variant="outline" disabled={!canLeaveDetails || busyPreview} onClick={() => void handlePreview()}>
                    {busyPreview ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
                    {busyPreview ? 'Anteprima…' : preview ? 'Rigenera anteprima' : 'Genera anteprima'}
                  </Button>
                </div>

                {preview && (
                  <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-primary">Anteprima del corso</p>
                      <p className="mt-1 text-base font-semibold">{preview.proposedTitle}</p>
                      {preview.description && <p className="mt-1 text-sm text-muted-foreground">{preview.description}</p>}
                    </div>
                    {preview.keyConcepts.length > 0 && (
                      <div>
                        <p className="mb-1 text-sm font-medium">Concetti chiave</p>
                        <ul className="list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
                          {preview.keyConcepts.map((c, i) => <li key={i}>{c}</li>)}
                        </ul>
                      </div>
                    )}
                    {preview.sources.length > 0 && (
                      <p className="text-xs text-muted-foreground">Fonti: {preview.sources.join(', ')} · {preview.examined} contenuti esaminati</p>
                    )}
                    <p className="text-xs italic text-muted-foreground">Nello step successivo rifinisci le lezioni e scegli il formato di ciascuna.</p>
                  </div>
                )}
              </div>
            )}

            {/* STEP 3 — Formato per lezione */}
            {step === 2 && (
              <div className="flex flex-col gap-5">
                <div className="space-y-2">
                  <Label className="text-base">Formato di default</Label>
                  <p className="text-xs text-muted-foreground">Applicato a tutte le lezioni, salvo le eccezioni che imposti sotto. Potrai rifinire ogni lezione anche dopo, nello step Struttura.</p>
                  <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Formato di default">
                    {FORMAT_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={formatDefault === o.value}
                        onClick={() => setFormatDefault(o.value)}
                        className={cn(
                          'rounded-lg border px-3 py-2 text-left transition-colors',
                          formatDefault === o.value ? 'border-primary bg-primary/10' : 'border-input hover:bg-accent/60',
                        )}
                      >
                        <span className="block text-sm font-medium">{o.label}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{o.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-base">Lezioni e formato</Label>
                    <span className="text-xs text-muted-foreground">{editedLessons.length} lezioni · modificabili</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Rimuovi o riscrivi le lezioni; cambia il formato solo dove serve (le altre usano il default).</p>
                  <ol className="space-y-1.5">
                    {editedLessons.map((l, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">{i + 1}.</span>
                        <Input
                          value={l}
                          maxLength={200}
                          aria-label={`Lezione ${i + 1}`}
                          className="h-9 flex-1 text-sm"
                          onChange={(e) => setEditedLessons((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                        />
                        <Select
                          aria-label={`Formato lezione ${i + 1}`}
                          className="h-9 w-32 text-xs"
                          value={lessonFormats[i] ?? formatDefault}
                          onChange={(e) => setLessonFormats((prev) => ({ ...prev, [i]: e.target.value as LessonFormatValue }))}
                        >
                          {FORMAT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </Select>
                        <button
                          type="button"
                          aria-label={`Rimuovi lezione ${i + 1}`}
                          className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => {
                            setEditedLessons((prev) => prev.filter((_, j) => j !== i));
                            setLessonFormats((prev) => {
                              const next: Record<number, LessonFormatValue> = {};
                              Object.entries(prev).forEach(([k, v]) => {
                                const idx = Number(k);
                                if (idx < i) next[idx] = v;
                                else if (idx > i) next[idx - 1] = v;
                              });
                              return next;
                            });
                          }}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </li>
                    ))}
                  </ol>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-8 gap-1.5 text-xs"
                    onClick={() => setEditedLessons((prev) => [...prev, ''])}
                  >
                    <Plus className="size-3.5" /> Aggiungi lezione
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 4 — Crea */}
            {step === 3 && (
              <div className="flex flex-col gap-4">
                <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                  <p className="font-medium">{title.trim() || preview?.proposedTitle || 'Nuovo corso'}</p>
                  <p className="mt-1 text-muted-foreground">
                    {origin === 'topic' ? `Da argomento: "${topic.trim()}"` : `Dal mio materiale: ${selectedDocs.length} documento${selectedDocs.length === 1 ? '' : 'i'}`}
                    {' · '}{editedLessons.length} lezioni · default {FORMAT_OPTIONS.find((o) => o.value === formatDefault)?.label}
                  </p>
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  Creiamo il corso e prepariamo il brief. Poi proseguirai con la generazione della struttura e dei contenuti.
                </div>
                <Button type="button" size="lg" disabled={busyCreate} onClick={() => void handleCreate()}>
                  {busyCreate ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                  {busyCreate ? 'Creazione…' : 'Crea corso'}
                </Button>
              </div>
            )}

            {/* Navigazione */}
            <div className="flex items-center justify-between border-t pt-4">
              <Button type="button" variant="ghost" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
                Indietro
              </Button>
              {step < STEPS.length - 1 ? (
                <Button
                  type="button"
                  disabled={(step === 0 && !canLeaveSource) || (step === 1 && !canLeaveDetails)}
                  onClick={() => {
                    if (step === 1 && !preview) {
                      toast.show('Genera prima l’anteprima', 'info');
                      return;
                    }
                    setStep((s) => Math.min(STEPS.length - 1, s + 1));
                  }}
                >
                  Continua
                </Button>
              ) : (
                <span />
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** Card di scelta della sorgente (step 1). */
function OriginCard({
  active,
  icon,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors',
        active ? 'border-primary bg-primary/10' : 'border-input hover:bg-accent/60',
      )}
    >
      <span className={cn('grid size-10 place-items-center rounded-lg', active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>
        {icon}
      </span>
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-xs text-muted-foreground">{desc}</span>
    </button>
  );
}
