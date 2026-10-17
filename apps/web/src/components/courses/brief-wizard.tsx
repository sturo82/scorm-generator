'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Brief, type Brief as BriefType } from '@scorm/contracts';
import { Plus, X, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dropzone } from '@/components/knowledge/dropzone';
import { useToast } from '@/components/ui/toast';
import { useBrands, useKnowledge, useUploadKnowledge } from '@/lib/api/hooks';
import { getApiClient } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import type { KnowledgeDocView } from '@/lib/api/types';

interface BriefWizardProps {
  courseId?: string;
  initial?: Partial<BriefType>;
  defaultTitle: string;
  defaultLanguage: string;
  onSubmit: (brief: BriefType) => Promise<void> | void;
  saving?: boolean;
}

const STEPS = ['Informazioni', 'Obiettivi', 'Test e brand'] as const;

/** Formati accettati per l'upload knowledge inline (coerente con /knowledge). */
const KNOWLEDGE_ACCEPT =
  '.pdf,.docx,.pptx,.xlsx,.txt,.md,.html,.csv,application/pdf,text/plain,text/markdown,text/html,text/csv';

/**
 * Wizard del brief in 3 step, validato con lo schema Brief dei contracts
 * (fonte di verità unica col backend). Mobile-first.
 */
export function BriefWizard({ courseId, initial, defaultTitle, defaultLanguage, onSubmit, saving }: BriefWizardProps) {
  const brands = useBrands();
  // Documenti selezionabili: knowledge globale del tenant + knowledge del corso.
  const globalDocs = useKnowledge('GLOBAL');
  const courseDocs = useKnowledge('COURSE', courseId);
  const uploadKnowledge = useUploadKnowledge();
  const toast = useToast();
  const [step, setStep] = React.useState(0);
  // Id dei documenti caricati inline dal wizard: appena diventano READY vengono
  // auto-selezionati (aggiunti a knowledgeDocIds). Il polling di useKnowledge li
  // porta da PENDING/PROCESSING a READY senza refresh manuale.
  const [pendingAutoSelect, setPendingAutoSelect] = React.useState<string[]>([]);

  const form = useForm<BriefType>({
    resolver: zodResolver(Brief),
    defaultValues: {
      title: initial?.title ?? defaultTitle,
      language: initial?.language ?? defaultLanguage,
      targetAudience: initial?.targetAudience ?? '',
      level: initial?.level ?? 'beginner',
      estimatedDurationMinutes: initial?.estimatedDurationMinutes ?? 60,
      tone: initial?.tone ?? '',
      desiredLessonCount: initial?.desiredLessonCount,
      learningObjectives: initial?.learningObjectives ?? [''],
      requestedAssessments: initial?.requestedAssessments ?? [],
      constraints: initial?.constraints ?? [],
      brandIds: initial?.brandIds ?? [],
      knowledgeDocIds: initial?.knowledgeDocIds ?? [],
      courseSourceDocIds: initial?.courseSourceDocIds ?? [],
      autoGenerateImages: initial?.autoGenerateImages ?? true,
      videoFirst: initial?.videoFirst ?? false,
      format: initial?.format ?? (initial?.videoFirst ? 'video_first' : 'completo'),
    },
  });

  const { register, handleSubmit, watch, setValue, formState, trigger } = form;
  const objectives = watch('learningObjectives');
  const assessments = watch('requestedAssessments');
  const brandIds = watch('brandIds');
  const knowledgeDocIds = watch('knowledgeDocIds');
  const courseSourceDocIds = watch('courseSourceDocIds');
  const autoGenerateImages = watch('autoGenerateImages');
  const format = watch('format') ?? (watch('videoFirst') ? 'video_first' : 'completo');
  // Documenti disponibili: globali (ready) + del corso (ready), deduplicati.
  const availableDocs = React.useMemo(() => {
    const all = [...(globalDocs.data ?? []), ...(courseDocs.data ?? [])];
    const seen = new Set<string>();
    return all.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
  }, [globalDocs.data, courseDocs.data]);

  // Separa le FONTI DEL CORSO (documenti costitutivi: articoli ingeriti dal
  // flusso "da argomento" + knowledge esistente agganciata) dalla knowledge
  // AGGIUNTIVA (resto della knowledge del tenant, opzionale). La verità è
  // brief.courseSourceDocIds; i doc del corso non marcati finiscono comunque
  // tra le fonti (retro-compatibilità con corsi creati prima del marcatore).
  const sourceIdSet = React.useMemo(() => new Set(courseSourceDocIds ?? []), [courseSourceDocIds]);
  const { courseSources, extraDocs } = React.useMemo(() => {
    const src: typeof availableDocs = [];
    const extra: typeof availableDocs = [];
    for (const d of availableDocs) {
      if (sourceIdSet.has(d.id)) src.push(d);
      else extra.push(d);
    }
    return { courseSources: src, extraDocs: extra };
  }, [availableDocs, sourceIdSet]);
  const whitelistEmpty = (knowledgeDocIds ?? []).length === 0;

  // Auto-selezione: quando un doc caricato inline diventa READY, lo aggiunge a
  // knowledgeDocIds e lo toglie dalla lista in attesa.
  React.useEffect(() => {
    if (pendingAutoSelect.length === 0) return;
    const readyIds = new Set(availableDocs.filter((d) => d.status === 'READY').map((d) => d.id));
    const nowReady = pendingAutoSelect.filter((id) => readyIds.has(id));
    if (nowReady.length === 0) return;
    const current = watch('knowledgeDocIds') ?? [];
    setValue('knowledgeDocIds', [...new Set([...current, ...nowReady])]);
    setPendingAutoSelect((prev) => prev.filter((id) => !readyIds.has(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableDocs]);

  async function handleUploadFiles(files: File[]) {
    if (!courseId) return;
    for (const file of files) {
      try {
        const doc = await uploadKnowledge.mutateAsync({ file, scope: 'COURSE', courseId });
        // Memorizza l'id: verrà auto-selezionato appena l'ingestion è READY.
        setPendingAutoSelect((prev) => [...new Set([...prev, doc.id])]);
        toast.show(`"${file.name}" caricato, elaborazione in corso…`, 'success');
      } catch (err) {
        toast.show(err instanceof Error ? err.message : 'Upload non riuscito', 'error');
      }
    }
  }

  async function next() {
    // Valida solo i campi dello step corrente prima di avanzare.
    const fields: Record<number, (keyof BriefType)[]> = {
      0: ['title', 'language', 'targetAudience', 'level', 'estimatedDurationMinutes'],
      1: ['learningObjectives'],
    };
    const ok = step in fields ? await trigger(fields[step]) : true;
    if (ok) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  return (
    <Card>
      <CardContent className="pt-6">
        {/* Stepper */}
        <ol className="mb-6 flex items-center gap-2 text-sm">
          {STEPS.map((label, i) => (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                  i <= step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}
              >
                {i + 1}
              </span>
              <span className={`hidden sm:inline ${i === step ? 'font-medium' : 'text-muted-foreground'}`}>
                {label}
              </span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" />}
            </li>
          ))}
        </ol>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
          {step === 0 && (
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="b-title">Titolo</Label>
                <Input id="b-title" {...register('title')} />
                <FieldError msg={formState.errors.title?.message} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="b-audience">Pubblico target</Label>
                <Input id="b-audience" placeholder="Es. Neoassunti" {...register('targetAudience')} />
                <FieldError msg={formState.errors.targetAudience?.message} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="b-level">Livello</Label>
                <Select id="b-level" {...register('level')}>
                  <option value="beginner">Base</option>
                  <option value="intermediate">Intermedio</option>
                  <option value="advanced">Avanzato</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="b-duration">Durata stimata (min)</Label>
                <Input id="b-duration" type="number" {...register('estimatedDurationMinutes', { valueAsNumber: true })} />
                <FieldError msg={formState.errors.estimatedDurationMinutes?.message} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="b-lang">Lingua</Label>
                <Select id="b-lang" {...register('language')}>
                  <option value="it">Italiano</option>
                  <option value="en">English</option>
                  <option value="es">Español</option>
                  <option value="fr">Français</option>
                  <option value="de">Deutsch</option>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="b-tone">Tono di voce (opzionale)</Label>
                <Input id="b-tone" placeholder="Es. professionale e rassicurante" {...register('tone')} />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <Label>Obiettivi di apprendimento</Label>
              {objectives.map((_, i) => (
                <div key={i} className="flex gap-2">
                  <Input {...register(`learningObjectives.${i}` as const)} placeholder={`Obiettivo ${i + 1}`} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Rimuovi obiettivo"
                    disabled={objectives.length <= 1}
                    onClick={() => setValue('learningObjectives', objectives.filter((_, j) => j !== i))}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              <FieldError msg={formState.errors.learningObjectives?.message as string | undefined} />
              <Button type="button" variant="outline" size="sm" onClick={() => setValue('learningObjectives', [...objectives, ''])}>
                <Plus className="size-4" /> Aggiungi obiettivo
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="space-y-3">
                <Label>Test richiesti</Label>
                <div className="flex flex-col gap-2">
                  <Checkbox
                    checked={assessments.includes('intermediate')}
                    onChange={(c) => setValue('requestedAssessments', toggle(assessments, 'intermediate', c))}
                    label="Test intermedi (per modulo)"
                  />
                  <Checkbox
                    checked={assessments.includes('final')}
                    onChange={(c) => setValue('requestedAssessments', toggle(assessments, 'final', c))}
                    label="Test finale di corso"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Label>Brand associati</Label>
                {brands.data && brands.data.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nessun brand definito. Potrai aggiungerli in seguito.</p>
                )}
                <div className="flex flex-col gap-2">
                  {brands.data?.map((b) => (
                    <Checkbox
                      key={b.id}
                      checked={(brandIds ?? []).includes(b.id)}
                      onChange={(c) => setValue('brandIds', toggle(brandIds ?? [], b.id, c))}
                      label={b.name}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label>Documenti knowledge per la generazione</Label>
                <p className="text-xs text-muted-foreground">
                  Scegli quali documenti usare come fonte. Se non selezioni nulla, la generazione
                  usa automaticamente tutta la knowledge pertinente.
                </p>

                {availableDocs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nessun documento ancora. Caricane uno qui sotto, oppure dalla sezione «Knowledge».
                  </p>
                ) : (
                  <div className="space-y-3">
                    {/* FONTI DEL CORSO: documenti costitutivi, evidenziati. */}
                    {courseSources.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            Fonti di questo corso
                          </span>
                          <span className="text-xs text-muted-foreground">
                            i contenuti su cui è costruito il corso
                          </span>
                        </div>
                        <div className="flex max-h-40 flex-col gap-2 overflow-auto rounded-lg border border-primary/30 bg-primary/5 p-2">
                          {courseSources.map((d) => (
                            <KnowledgeDocRow
                              key={d.id}
                              doc={d}
                              checked={(knowledgeDocIds ?? []).includes(d.id)}
                              isCourseSource
                              onToggle={(c) => {
                                if (!c) {
                                  toast.show(
                                    `"${d.filename}" è una fonte di questo corso: rimuoverla può renderlo incoerente.`,
                                    'error',
                                  );
                                }
                                setValue('knowledgeDocIds', toggle(knowledgeDocIds ?? [], d.id, c));
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* KNOWLEDGE AGGIUNTIVA: resto della knowledge del tenant. */}
                    {extraDocs.length > 0 && (
                      <div className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">
                          Knowledge aggiuntiva {courseSources.length > 0 ? '(opzionale)' : ''}
                        </span>
                        <div className="flex max-h-40 flex-col gap-2 overflow-auto rounded-lg border p-2">
                          {extraDocs.map((d) => (
                            <KnowledgeDocRow
                              key={d.id}
                              doc={d}
                              checked={(knowledgeDocIds ?? []).includes(d.id)}
                              onToggle={(c) =>
                                setValue('knowledgeDocIds', toggle(knowledgeDocIds ?? [], d.id, c))
                              }
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Avviso: whitelist svuotata → la generazione usa TUTTA la knowledge. */}
                {availableDocs.length > 0 && whitelistEmpty && (
                  <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Nessun documento selezionato: la generazione userà tutta la knowledge pertinente
                    del tenant, non solo le fonti di questo corso.
                  </p>
                )}

                {/* Upload inline: disponibile solo con un corso già creato (scope COURSE). */}
                {courseId && (
                  <div className="space-y-1">
                    <Dropzone
                      onFiles={handleUploadFiles}
                      accept={KNOWLEDGE_ACCEPT}
                      disabled={uploadKnowledge.isPending}
                    />
                    <p className="text-xs text-muted-foreground">
                      I documenti caricati qui vengono associati al corso e, appena pronti, sono
                      selezionati automaticamente come fonte.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <Checkbox
                  checked={autoGenerateImages !== false}
                  onChange={(c) => setValue('autoGenerateImages', c)}
                  label="Genera automaticamente le immagini delle lezioni"
                />
                <p className="pl-6 text-xs text-muted-foreground">
                  Lezioni già illustrate alla generazione. Disattiva per risparmiare tempo/budget
                  (le immagini restano generabili manualmente).
                </p>
              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <Label>Formato del corso</Label>
                <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Formato del corso">
                  {([
                    ['completo', 'Completo', 'Testo, immagini, interazioni e quiz. Il formato classico.'],
                    ['video_first', 'Video-first', 'Ogni lezione è incentrata su un video, con elementi e quiz affiancati.'],
                    ['pillole', 'Pillole', 'Mini-video interattivi in stile libro-game: scegli e scopri le conseguenze.'],
                  ] as Array<['completo' | 'video_first' | 'pillole', string, string]>).map(
                    ([val, title, desc]) => (
                      <button
                        key={val}
                        type="button"
                        role="radio"
                        aria-checked={format === val}
                        onClick={() => {
                          setValue('format', val);
                          // Mantiene videoFirst allineato (compat con prompt/player).
                          setValue('videoFirst', val === 'video_first');
                        }}
                        className={cn(
                          'rounded-lg border p-3 text-left transition-colors',
                          format === val
                            ? 'border-primary bg-primary/10'
                            : 'border-input hover:bg-accent/60',
                        )}
                      >
                        <span className="block text-sm font-medium">{title}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{desc}</span>
                      </button>
                    ),
                  )}
                </div>
                {format === 'pillole' && (
                  <p className="pl-1 text-xs text-muted-foreground">
                    Ogni pillola è un breve percorso a scene con scelte e conseguenze. I mini-video
                    (cartoon) sono segnaposto da caricare; la generazione ne produce lo storyboard.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button type="button" variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
              Indietro
            </Button>
            {step < STEPS.length - 1 ? (
              // key distinto dal pulsante submit: evita che React riusi lo stesso
              // nodo DOM cambiandone solo il type (altrimenti il click su «Avanti»
              // che porta all'ultimo step farebbe partire subito il submit).
              <Button key="next" type="button" onClick={next}>
                Avanti
              </Button>
            ) : (
              <Button key="submit" type="submit" disabled={saving}>
                {saving ? 'Salvataggio…' : 'Salva brief'}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-xs text-destructive">{msg}</p>;
}

function toggle<T>(arr: T[], value: T, on: boolean): T[] {
  return on ? [...new Set([...arr, value])] : arr.filter((x) => x !== value);
}

/** Riga di un documento knowledge selezionabile nel wizard (fonte o aggiuntivo). */
function KnowledgeDocRow({
  doc,
  checked,
  onToggle,
  isCourseSource = false,
}: {
  doc: KnowledgeDocView;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  isCourseSource?: boolean;
}) {
  const toast = useToast();
  const busy = doc.status === 'PENDING' || doc.status === 'PROCESSING';
  const failed = doc.status === 'FAILED';
  const [downloading, setDownloading] = React.useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const url = await getApiClient().getKnowledgeDownloadUrl(doc.id);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.filename;
      a.rel = 'noopener';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Download non riuscito', 'error');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <Checkbox
          checked={checked}
          onChange={onToggle}
          disabled={busy || failed}
          label={`${doc.filename}${!isCourseSource && doc.scope === 'COURSE' ? ' (corso)' : ''}`}
        />
      </div>
      {busy && <span className="text-xs text-muted-foreground">elaborazione…</span>}
      {failed && <span className="text-xs text-destructive">errore</span>}
      <button
        type="button"
        aria-label={`Scarica ${doc.filename}`}
        title="Scarica"
        disabled={downloading}
        onClick={() => void handleDownload()}
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <Download className="size-4" />
      </button>
    </div>
  );
}
