'use client';

import * as React from 'react';
import { Check, ChevronRight, FileText, ListTree, Wand2, Image as ImageIcon, Eye, Search } from 'lucide-react';
import type { Brief } from '@scorm/contracts';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { BriefWizard } from '@/components/courses/brief-wizard';
import { CourseBuilder } from '@/components/courses/course-builder';
import { CoursePreview } from '@/components/courses/course-preview';
import { CoursePricingPanel } from '@/components/courses/course-pricing-panel';
import { ExportDialog } from '@/components/courses/export-dialog';
import { useToast } from '@/components/ui/toast';
import {
  useCourse,
  useModules,
  useSaveBrief,
  useGenerateCover,
  useAttachStockCover,
  useUpdateCourseSettings,
  useUploadInstructorAvatar,
  useActiveJobs,
  useBrands,
} from '@/lib/api/hooks';
import { StockPhotoPicker } from '@/components/courses/stock-photo-picker';
import { cn } from '@/lib/cn';

type StepId = 'brief' | 'structure' | 'content' | 'cover' | 'review';

interface StepDef {
  id: StepId;
  title: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STEPS: StepDef[] = [
  { id: 'brief', title: 'Brief', hint: 'Definisci obiettivi e pubblico del corso.', icon: FileText },
  { id: 'structure', title: 'Struttura', hint: 'Genera moduli e lezioni dal brief con un clic.', icon: ListTree },
  { id: 'content', title: 'Contenuti', hint: 'Genera i contenuti didattici delle lezioni.', icon: Wand2 },
  { id: 'cover', title: 'Media', hint: 'Copertina, immagini e narrazione.', icon: ImageIcon },
  { id: 'review', title: 'Anteprima & Export', hint: 'Rivedi e scarica il pacchetto SCORM.', icon: Eye },
];

/**
 * Wizard guidato end-to-end: accompagna dalla definizione del brief fino
 * all'export, con stato di avanzamento derivato dai dati reali del corso. Ogni
 * step è navigabile; quelli completati sono marcati e si può procedere al
 * successivo con un pulsante esplicito.
 */
export function CourseWizard({ courseId }: { courseId: string }) {
  const course = useCourse(courseId);
  const modules = useModules(courseId);
  const saveBrief = useSaveBrief(courseId);
  const genCover = useGenerateCover(courseId);
  const attachStockCover = useAttachStockCover(courseId);
  const updateSettings = useUpdateCourseSettings(courseId);
  const activeJobs = useActiveJobs(courseId);
  const toast = useToast();
  const [active, setActive] = React.useState<StepId>('brief');
  const [coverStockOpen, setCoverStockOpen] = React.useState(false);

  // Generazione in corso (banner persistente + blocco azioni in conflitto).
  const jobsActive = activeJobs.data ?? [];
  const batchActive = jobsActive.some((j) => j.type === 'course.generate_all_content');
  const generationActive = jobsActive.length > 0;

  // Stato di completamento derivato dai dati.
  const hasBrief = Boolean(course.data?.brief?.title && course.data.brief.learningObjectives?.length);
  const mods = modules.data ?? [];
  const hasStructure = mods.length > 0 && mods.some((m) => m.lessons.length > 0);
  const hasContent = mods.some((m) => m.lessons.some((l) => l.blocks.length > 0));
  const hasCover = Boolean(course.data?.coverImageUrl);
  const done: Record<StepId, boolean> = {
    brief: hasBrief,
    structure: hasStructure,
    content: hasContent,
    cover: hasCover,
    review: false,
  };
  const completedCount = Object.values(done).filter(Boolean).length;
  const progressPct = Math.round((completedCount / STEPS.length) * 100);

  async function handleSaveBrief(brief: Brief) {
    try {
      await saveBrief.mutateAsync(brief);
      toast.show('Brief salvato', 'success');
      setActive('structure');
    } catch {
      toast.show('Salvataggio non riuscito', 'error');
    }
  }

  async function handleGenerateCover() {
    try {
      await genCover.mutateAsync();
      toast.show('Copertina generata', 'success');
    } catch {
      toast.show('Generazione copertina non riuscita', 'error');
    }
  }

  async function handleSetNavPosition(pos: 'side' | 'top') {
    if ((course.data?.navPosition ?? 'side') === pos) return;
    try {
      await updateSettings.mutateAsync({ navPosition: pos });
      toast.show(pos === 'top' ? 'Menu in alto applicato' : 'Menu a lato applicato', 'success');
    } catch {
      toast.show('Aggiornamento non riuscito', 'error');
    }
  }

  async function handleSetInteractionStyle(style: 'sober' | 'lively') {
    if (course.data?.interactionStyle === style) return;
    try {
      await updateSettings.mutateAsync({ interactionStyle: style });
      toast.show(style === 'lively' ? 'Stile vivace applicato' : 'Stile sobrio applicato', 'success');
    } catch {
      toast.show('Impostazione non salvata', 'error');
    }
  }

  async function handleSetPrimaryBrand(brandId: string) {
    if (course.data?.primaryBrandId === brandId) return;
    try {
      await updateSettings.mutateAsync({ primaryBrandId: brandId });
      toast.show('Brand del corso aggiornato', 'success');
    } catch {
      toast.show('Brand non salvato', 'error');
    }
  }

  async function handleSetInstructor(name: string, role: string) {
    try {
      await updateSettings.mutateAsync({ instructor: { name, role } });
      toast.show('Docente aggiornato', 'success');
    } catch {
      toast.show('Docente non salvato', 'error');
    }
  }

  function goNext() {
    const idx = STEPS.findIndex((s) => s.id === active);
    if (idx < STEPS.length - 1) setActive(STEPS[idx + 1]!.id);
  }

  return (
    <div className="space-y-6">
      {/* Banner persistente: generazione in corso, visibile in ogni step. */}
      {generationActive && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 shadow-card">
          <span className="relative flex size-2.5 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-primary">
              {batchActive ? 'Generazione dei contenuti in corso' : 'Generazione AI in corso'}
            </p>
            <p className="text-xs text-muted-foreground">
              Prosegue sul server anche se ricarichi o navighi altrove. Puoi continuare a lavorare
              sugli altri passi; evita di rigenerare struttura o contenuti finché non termina.
            </p>
          </div>
        </div>
      )}

      {/* Stepper */}
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium">Avanzamento</p>
          <span className="text-xs text-muted-foreground">{progressPct}%</span>
        </div>
        <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        <ol className="grid gap-2 sm:grid-cols-5">
          {STEPS.map((step, i) => {
            const isActive = step.id === active;
            const isDone = done[step.id];
            const Icon = step.icon;
            return (
              <li key={step.id}>
                <button
                  onClick={() => setActive(step.id)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-lg border p-2 text-left transition',
                    isActive ? 'border-primary bg-accent/50' : 'hover:bg-accent/30',
                  )}
                  aria-current={isActive ? 'step' : undefined}
                >
                  <span
                    className={cn(
                      'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
                      isDone ? 'bg-primary text-primary-foreground' : 'border text-muted-foreground',
                    )}
                  >
                    {isDone ? <Check className="size-3.5" /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 text-sm font-medium">
                      <Icon className="size-3.5" /> {step.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">{step.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Contenuto dello step attivo */}
      {active === 'brief' && (
        <StepShell title="1. Definisci il brief" onNext={hasBrief ? goNext : undefined} nextLabel="Vai alla struttura">
          <BriefWizard
            courseId={courseId}
            initial={course.data?.brief ?? undefined}
            defaultTitle={course.data?.title ?? ''}
            defaultLanguage={course.data?.language ?? 'it'}
            onSubmit={handleSaveBrief}
            saving={saveBrief.isPending}
          />
        </StepShell>
      )}

      {active === 'structure' && (
        <StepShell
          title="2. Struttura del corso"
          description="Genera l’outline dal brief, poi crea moduli e lezioni con «Crea struttura dall’outline»."
          onNext={hasStructure ? goNext : undefined}
          nextLabel="Vai ai contenuti"
          blockedHint={!hasStructure ? 'Genera la struttura (o aggiungi un modulo) per procedere.' : undefined}
        >
          <CourseBuilder courseId={courseId} mode="structure" />
        </StepShell>
      )}

      {active === 'content' && (
        <StepShell
          title="3. Contenuti delle lezioni"
          description="Genera i contenuti di tutte le lezioni con un clic, o una alla volta. Il materiale spiega prima, poi verifica."
          onNext={hasContent ? goNext : undefined}
          nextLabel="Vai ai media"
          blockedHint={!hasContent ? 'Genera i contenuti di almeno una lezione per procedere.' : undefined}
        >
          <CourseBuilder courseId={courseId} mode="content" />
        </StepShell>
      )}

      {active === 'cover' && (
        <StepShell
          title="4. Media del corso"
          description="Genera la copertina del corso. Immagini e narrazione delle lezioni si generano nello step Contenuti."
          onNext={goNext}
          nextLabel="Vai all’anteprima"
        >
          <div className="overflow-hidden rounded-xl border bg-card">
            {course.data?.coverImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL firmato dinamico
              <img
                src={course.data.coverImageUrl}
                alt={`Copertina: ${course.data.title}`}
                className="aspect-[21/9] w-full object-cover"
              />
            ) : (
              <div className="flex aspect-[21/9] w-full flex-col items-center justify-center gap-3 bg-muted/40 text-center">
                <p className="text-sm text-muted-foreground">Nessuna copertina generata</p>
              </div>
            )}
            <div className="flex justify-end gap-2 p-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCoverStockOpen(true)}
                disabled={attachStockCover.isPending}
              >
                <Search className="size-4" />
                {attachStockCover.isPending ? 'Imposto…' : 'Scegli da Unsplash'}
              </Button>
              <Button variant="outline" size="sm" onClick={handleGenerateCover} disabled={genCover.isPending}>
                <ImageIcon className="size-4" />
                {genCover.isPending ? 'Generazione…' : course.data?.coverImageUrl ? 'Rigenera copertina' : 'Genera copertina'}
              </Button>
            </div>
          </div>

          <StockPhotoPicker
            open={coverStockOpen}
            courseId={courseId}
            title="Scegli la copertina da Unsplash"
            saving={attachStockCover.isPending}
            onClose={() => setCoverStockOpen(false)}
            onSelect={async (photo) => {
              try {
                await attachStockCover.mutateAsync({ photoId: photo.id, provider: photo.provider });
                toast.show('Copertina impostata da Unsplash', 'success');
                setCoverStockOpen(false);
              } catch (err) {
                toast.show(
                  err instanceof Error && /501|non configurata/i.test(err.message)
                    ? 'Libreria immagini stock non configurata sul server'
                    : 'Impostazione copertina non riuscita',
                  'error',
                );
              }
            }}
          />

          <BrandPicker
            value={course.data?.primaryBrandId}
            onChange={handleSetPrimaryBrand}
            saving={updateSettings.isPending}
          />

          <InstructorPicker
            courseId={courseId}
            value={course.data?.instructor}
            onSave={handleSetInstructor}
            saving={updateSettings.isPending}
          />

          <InteractionStylePicker
            value={course.data?.interactionStyle ?? 'sober'}
            onChange={handleSetInteractionStyle}
            saving={updateSettings.isPending}
          />

          <NavPositionPicker
            value={course.data?.navPosition ?? 'side'}
            onChange={handleSetNavPosition}
            saving={updateSettings.isPending}
          />
        </StepShell>
      )}

      {active === 'review' && (
        <StepShell title="5. Anteprima & Export" description="Controlla il risultato, poi scarica il pacchetto SCORM.">
          <div className="mb-4 flex justify-end">
            <ExportDialog courseId={courseId} />
          </div>
          <div className="mb-6">
            <CoursePricingPanel courseId={courseId} />
          </div>
          <CoursePreview courseId={courseId} />
        </StepShell>
      )}
    </div>
  );
}

/**
 * Docente del corso: nome + ruolo, mostrati nell'header sempre visibile di
 * anteprima e player SCORM. Salvataggio esplicito (il campo nome pilota la
 * presenza del docente).
 */
function InstructorPicker({
  courseId,
  value,
  onSave,
  saving,
}: {
  courseId: string;
  value?: { name: string; role?: string; avatarUrl?: string };
  onSave: (name: string, role: string) => void;
  saving?: boolean;
}) {
  const [name, setName] = React.useState(value?.name ?? '');
  const [role, setRole] = React.useState(value?.role ?? '');
  const uploadAvatar = useUploadInstructorAvatar(courseId);
  const toast = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  // Allinea i campi quando arrivano i dati del corso.
  React.useEffect(() => {
    setName(value?.name ?? '');
    setRole(value?.role ?? '');
  }, [value?.name, value?.role]);

  const dirty = name.trim() !== (value?.name ?? '') || role.trim() !== (value?.role ?? '');
  const hasName = Boolean(value?.name) || name.trim().length > 0;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!value?.name && !name.trim()) {
      toast.show('Inserisci e salva prima il nome del docente', 'error');
      return;
    }
    try {
      await uploadAvatar.mutateAsync(file);
      toast.show('Foto del docente caricata', 'success');
    } catch {
      toast.show('Caricamento foto non riuscito', 'error');
    }
  }

  return (
    <fieldset className="rounded-xl border bg-card p-4" disabled={saving}>
      <legend className="px-1 text-sm font-medium">Docente</legend>
      <p className="mb-3 text-xs text-muted-foreground">
        Nome, ruolo e foto del docente, mostrati nell’header del corso (anteprima e pacchetto SCORM).
      </p>
      <div className="flex items-start gap-4">
        {/* Avatar + upload */}
        <div className="flex flex-col items-center gap-2">
          <span className="grid size-16 place-items-center overflow-hidden rounded-full border bg-muted text-lg font-bold text-muted-foreground">
            {value?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- avatar firmato
              <img src={value.avatarUrl} alt="" className="size-full object-cover" />
            ) : (
              (value?.name || name || '?').charAt(0).toUpperCase()
            )}
          </span>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFile} />
          <Button
            size="sm"
            variant="ghost"
            type="button"
            disabled={!hasName || uploadAvatar.isPending}
            onClick={() => fileRef.current?.click()}
          >
            {uploadAvatar.isPending ? 'Caricamento…' : 'Carica foto'}
          </Button>
        </div>
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="instr-name">Nome</Label>
            <Input id="instr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. Mario Rossi" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="instr-role">Ruolo (opzionale)</Label>
            <Input id="instr-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Es. Responsabile Sicurezza" />
          </div>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="outline" disabled={!dirty || saving} onClick={() => onSave(name.trim(), role.trim())}>
          Salva docente
        </Button>
      </div>
    </fieldset>
  );
}

/**
 * Selettore del brand primario del corso. Pilota colori, logo e accenti sia
 * nell'anteprima sia nel pacchetto SCORM esportato (ed è il default dell'export).
 */
function BrandPicker({
  value,
  onChange,
  saving,
}: {
  value?: string;
  onChange: (brandId: string) => void;
  saving?: boolean;
}) {
  const brands = useBrands();
  const list = brands.data ?? [];
  return (
    <fieldset className="rounded-xl border bg-card p-4" disabled={saving}>
      <legend className="px-1 text-sm font-medium">Brand del corso</legend>
      <p className="mb-3 text-xs text-muted-foreground">
        Colori, logo e accenti del corso. Si applica all’anteprima e al pacchetto SCORM esportato.
      </p>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nessun brand definito. Creane uno nella sezione «Brand» per personalizzare il corso.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {list.map((b) => {
            const selected = value === b.id;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => onChange(b.id)}
                aria-pressed={selected}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-3 text-left transition',
                  selected ? 'border-primary bg-accent/50 ring-1 ring-primary' : 'hover:bg-accent/30',
                )}
              >
                <span
                  className="size-6 shrink-0 rounded-full border"
                  style={{ background: b.colors?.primary ?? '#888' }}
                  aria-hidden
                />
                <span className="flex items-center gap-2 text-sm font-medium">
                  {selected && <Check className="size-3.5 text-primary" />}
                  {b.name}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

/**
 * Selettore dello stile delle micro-interazioni del corso (Blocco F). La scelta
 * è salvata sul corso e si riflette identica nell'anteprima e nel pacchetto
 * SCORM esportato. Modificabile anche dopo la creazione.
 */
function InteractionStylePicker({
  value,
  onChange,
  saving,
}: {
  value: 'sober' | 'lively';
  onChange: (style: 'sober' | 'lively') => void;
  saving?: boolean;
}) {
  const options: Array<{ id: 'sober' | 'lively'; title: string; desc: string }> = [
    { id: 'sober', title: 'Sobrio', desc: 'Transizioni morbide ed essenziali. Ideale per contesti corporate.' },
    { id: 'lively', title: 'Vivace', desc: 'Animazioni più espressive: rimbalzi, pulsazioni, celebrazione dei quiz.' },
  ];
  return (
    <fieldset className="rounded-xl border bg-card p-4" disabled={saving}>
      <legend className="px-1 text-sm font-medium">Stile delle interazioni</legend>
      <p className="mb-3 text-xs text-muted-foreground">
        Governa le animazioni di flashcard, quiz, accordion e hotspot. Entrambi gli stili rispettano
        la preferenza «riduci animazioni» del sistema.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const selected = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              aria-pressed={selected}
              className={cn(
                'rounded-lg border p-3 text-left transition',
                selected ? 'border-primary bg-accent/50 ring-1 ring-primary' : 'hover:bg-accent/30',
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                {selected && <Check className="size-3.5 text-primary" />}
                {opt.title}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{opt.desc}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Scelta della posizione del menu/indice di navigazione: a lato (sidebar) o in
 * alto (barra espandibile). Applicata identica ad anteprima e player SCORM.
 */
function NavPositionPicker({
  value,
  onChange,
  saving,
}: {
  value: 'side' | 'top';
  onChange: (pos: 'side' | 'top') => void;
  saving?: boolean;
}) {
  const options: Array<{ id: 'side' | 'top'; title: string; desc: string }> = [
    { id: 'side', title: 'A lato', desc: 'Indice sempre visibile in una colonna a sinistra (su schermi stretti si impila sopra).' },
    { id: 'top', title: 'In alto', desc: 'Barra «Programma del corso» espandibile sopra il contenuto.' },
  ];
  return (
    <fieldset className="rounded-xl border bg-card p-4" disabled={saving}>
      <legend className="px-1 text-sm font-medium">Posizione del menu</legend>
      <p className="mb-3 text-xs text-muted-foreground">
        Dove mostrare l&apos;indice di navigazione del corso. Identico in anteprima e nel pacchetto
        SCORM esportato.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const selected = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              aria-pressed={selected}
              className={cn(
                'rounded-lg border p-3 text-left transition',
                selected ? 'border-primary bg-accent/50 ring-1 ring-primary' : 'hover:bg-accent/30',
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                {selected && <Check className="size-3.5 text-primary" />}
                {opt.title}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{opt.desc}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Contenitore di uno step con titolo, descrizione e azione «Avanti». */
function StepShell({
  title,
  description,
  children,
  onNext,
  nextLabel = 'Avanti',
  blockedHint,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  onNext?: () => void;
  nextLabel?: string;
  blockedHint?: string;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
      <div className="flex items-center justify-end gap-3 border-t pt-4">
        {blockedHint && <p className="text-xs text-muted-foreground">{blockedHint}</p>}
        {onNext && (
          <Button onClick={onNext}>
            {nextLabel} <ChevronRight className="size-4" />
          </Button>
        )}
      </div>
    </section>
  );
}
