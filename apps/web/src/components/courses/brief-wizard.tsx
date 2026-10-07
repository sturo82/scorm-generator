'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Brief, type Brief as BriefType } from '@scorm/contracts';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useBrands, useKnowledge } from '@/lib/api/hooks';

interface BriefWizardProps {
  courseId?: string;
  initial?: Partial<BriefType>;
  defaultTitle: string;
  defaultLanguage: string;
  onSubmit: (brief: BriefType) => Promise<void> | void;
  saving?: boolean;
}

const STEPS = ['Informazioni', 'Obiettivi', 'Test e brand'] as const;

/**
 * Wizard del brief in 3 step, validato con lo schema Brief dei contracts
 * (fonte di verità unica col backend). Mobile-first.
 */
export function BriefWizard({ courseId, initial, defaultTitle, defaultLanguage, onSubmit, saving }: BriefWizardProps) {
  const brands = useBrands();
  // Documenti selezionabili: knowledge globale del tenant + knowledge del corso.
  const globalDocs = useKnowledge('GLOBAL');
  const courseDocs = useKnowledge('COURSE', courseId);
  const [step, setStep] = React.useState(0);

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
      autoGenerateImages: initial?.autoGenerateImages ?? true,
      videoFirst: initial?.videoFirst ?? false,
    },
  });

  const { register, handleSubmit, watch, setValue, formState, trigger } = form;
  const objectives = watch('learningObjectives');
  const assessments = watch('requestedAssessments');
  const videoFirst = watch('videoFirst');
  const brandIds = watch('brandIds');
  const knowledgeDocIds = watch('knowledgeDocIds');
  const autoGenerateImages = watch('autoGenerateImages');
  // Documenti disponibili: globali (ready) + del corso (ready), deduplicati.
  const availableDocs = React.useMemo(() => {
    const all = [...(globalDocs.data ?? []), ...(courseDocs.data ?? [])];
    const seen = new Set<string>();
    return all.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
  }, [globalDocs.data, courseDocs.data]);

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
                    Nessun documento disponibile. Caricali nella sezione «Knowledge».
                  </p>
                ) : (
                  <div className="flex max-h-48 flex-col gap-2 overflow-auto rounded-lg border p-2">
                    {availableDocs.map((d) => (
                      <Checkbox
                        key={d.id}
                        checked={(knowledgeDocIds ?? []).includes(d.id)}
                        onChange={(c) => setValue('knowledgeDocIds', toggle(knowledgeDocIds ?? [], d.id, c))}
                        label={`${d.filename}${d.scope === 'COURSE' ? ' (corso)' : ''}`}
                      />
                    ))}
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
                <Checkbox
                  checked={videoFirst === true}
                  onChange={(c) => setValue('videoFirst', c)}
                  label="Corso video-first (ogni lezione incentrata su un video)"
                />
                <p className="pl-6 text-xs text-muted-foreground">
                  Ogni lezione sarà costruita attorno a un video (segnaposto da riempire caricando
                  il file) con elementi dinamici e quiz affiancati. Puoi comunque marcare singole
                  lezioni come video nello step «Struttura».
                </p>
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
