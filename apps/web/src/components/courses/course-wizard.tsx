'use client';

import * as React from 'react';
import { Check, ChevronRight, ChevronDown, FileText, Wand2, Image as ImageIcon, Eye, Search } from 'lucide-react';
import type { Brief } from '@scorm/contracts';
import { CreditCost } from '@/components/ui/credit-cost';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { BriefWizard } from '@/components/courses/brief-wizard';
import { CourseSourcesPanel } from '@/components/courses/course-sources-panel';
import { CourseBuilder } from '@/components/courses/course-builder';
import { CoursePreview } from '@/components/courses/course-preview';
import { CoursePricingPanel } from '@/components/courses/course-pricing-panel';
import { CourseBudget } from '@/components/app/course-budget';
import { ExportDialog } from '@/components/courses/export-dialog';
import { useToast } from '@/components/ui/toast';
import {
  useCourse,
  useModules,
  useSaveBrief,
  useGenerateCover,
  useAttachStockCover,
  useUploadCover,
  useUpdateCourseSettings,
  useUploadInstructorAvatar,
  useSetCourseShareable,
  useActiveJobs,
  useBrands,
  useWallet,
  useConfirmCourseBudget,
} from '@/lib/api/hooks';
import { StockPhotoPicker } from '@/components/courses/stock-photo-picker';
import { CoverFramer, COVER_ASPECT } from '@/components/courses/cover-framer';
import { usePendingAssessments } from '@/lib/use-pending-assessments';
import { cn } from '@/lib/cn';
import { wizardLandingKey } from '@/lib/wizard-landing';
import { getSession } from '@/lib/auth';
import { slidesAutoOpenKey } from '@/lib/slides-autoopen';

type TabId = 'content' | 'settings' | 'publish';
interface TabDef {
  id: TabId;
  title: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}
/** Le tre aree del corso: che cosa insegna, come si presenta, come si pubblica. */
const TABS: TabDef[] = [
  { id: 'content', title: 'Contenuti', hint: 'Moduli, lezioni e test.', icon: Wand2 },
  { id: 'settings', title: 'Impostazioni', hint: 'Obiettivi, fonti, copertina, brand e docente.', icon: FileText },
  { id: 'publish', title: 'Pubblica', hint: 'Anteprima, esportazione SCORM e costi.', icon: Eye },
];
/**
 * Pagina del corso: una frase di stato con la prossima azione e tre aree (Contenuti, Impostazioni,
 * Pubblica). Lo stato deriva dai dati reali del corso; la generazione automatica prosegue sul server.
 */
export function CourseWizard({ courseId }: { courseId: string }) {
  const course = useCourse(courseId);
  const creditsOn = useWallet().data?.enabled === true;
  const modules = useModules(courseId);
  const saveBrief = useSaveBrief(courseId);
  const confirmBudget = useConfirmCourseBudget(courseId);
  const genCover = useGenerateCover(courseId);
  const attachStockCover = useAttachStockCover(courseId);
  const uploadCover = useUploadCover(courseId);
  const updateSettings = useUpdateCourseSettings(courseId);
  const setShareable = useSetCourseShareable(courseId);
  const activeJobs = useActiveJobs(courseId);
  const toast = useToast();
  const [active, setActive] = React.useState<TabId>('content');
  // Il passo iniziale si calcola dallo stato reale del corso (una volta sola), così chi apre un corso
  // già avanzato, anche di un collega, non riparte dal brief. I flag locali (anteprima dopo la
  // generazione automatica, dialog slide) hanno la precedenza.
  const landedRef = React.useRef(false);
  const startedRef = React.useRef(false);
  // Corso creato dal percorso "Da slide": apre il passo Struttura con il dialog già aperto.
  const [autoOpenSlides, setAutoOpenSlides] = React.useState(false);
  React.useEffect(() => {
    try {
      const key = slidesAutoOpenKey(courseId);
      if (window.localStorage.getItem(key) === '1') {
        window.localStorage.removeItem(key);
        landedRef.current = true;
        setActive('content');
        setAutoOpenSlides(true);
      }
      // Dopo una generazione automatica si apre l'anteprima.
      const landing = wizardLandingKey(courseId);
      if (window.localStorage.getItem(landing) === 'review') {
        window.localStorage.removeItem(landing);
        landedRef.current = true;
        setActive('publish');
      }
    } catch {
      /* storage non disponibile */
    }
  }, [courseId]);
  const [coverStockOpen, setCoverStockOpen] = React.useState(false);
  // Punto focale verticale della copertina (0-100): stato locale per uno slider
  // fluido; il salvataggio avviene al rilascio (onPointerUp/change).
  const [coverPos, setCoverPos] = React.useState<number>(50);
  React.useEffect(() => {
    if (typeof course.data?.coverPosition === 'number') setCoverPos(course.data.coverPosition);
  }, [course.data?.coverPosition]);
  // Evidenziazione temporanea della card test quando si arriva dal banner.
  const [highlightTests, setHighlightTests] = React.useState(false);

  // Test ancora da generare (banner sempre visibile + azione "genera tutti").
  const pendingTests = usePendingAssessments(courseId, modules.data ?? []);

  // Porta l'utente alla sezione test: step Contenuti + scroll + evidenziazione.
  function goToTests() {
    setActive('content');
    setHighlightTests(true);
    // Attende il render dello step prima di scrollare alla card dei test.
    setTimeout(() => {
      document.getElementById('course-tests')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    setTimeout(() => setHighlightTests(false), 2600);
  }

  async function handleGenerateAllTests() {
    try {
      const started = await pendingTests.generateAllPending();
      toast.show(
        started
          ? 'Generazione test avviata: prosegue sul server anche se chiudi la pagina'
          : 'Genera prima i contenuti delle lezioni',
        started ? 'success' : 'info',
      );
    } catch {
      toast.show('Avvio della generazione non riuscito', 'error');
    }
  }

  // Generazione in corso (banner persistente + blocco azioni in conflitto).
  const jobsActive = activeJobs.data ?? [];
  const batchActive = jobsActive.some((j) => j.type === 'course.generate_all_content');
  const generationActive = jobsActive.length > 0;

  // Stato di completamento derivato dai dati.
  const hasBrief = Boolean(course.data?.brief?.title && course.data.brief.learningObjectives?.length);
  const mods = modules.data ?? [];
  const hasStructure = mods.length > 0 && mods.some((m) => m.lessons.length > 0);
  const hasCover = Boolean(course.data?.coverImageUrl);
  const allLessonsReady = hasStructure && mods.every((m) => m.lessons.every((l) => l.blocks.length > 0));
  React.useEffect(() => {
    if (startedRef.current || !course.data || !modules.data) return;
    startedRef.current = true;
    if (landedRef.current) return;
    if (allLessonsReady) setActive('publish');
    else if (!hasStructure && !hasBrief) setActive('settings');
  }, [course.data, modules.data, allLessonsReady, hasStructure, hasBrief]);
  const me = getSession()?.user.id;
  const author = course.data?.createdBy;
  const othersCourse = Boolean(author && me && author.id !== me);
  // Avanzamento: struttura, contenuti, test, copertina, tutto approvato dall'utente (quando serve).
  const milestones = [hasStructure, allLessonsReady, pendingTests.pendingCount === 0 && hasStructure, hasCover];
  const progressPct = Math.round((milestones.filter(Boolean).length / milestones.length) * 100);
  const [structureOpen, setStructureOpen] = React.useState(false);
  // Frase di stato e prossima azione: l'utente deve sapere sempre dove si trova.
  const next: { text: string; action?: { label: string; run: () => void } } = generationActive
    ? { text: batchActive ? 'Stiamo scrivendo le lezioni. Puoi chiudere la pagina: il lavoro prosegue sul server.' : 'Stiamo generando: il lavoro prosegue sul server anche se chiudi la pagina.' }
    : !hasStructure
      ? { text: 'Il corso non ha ancora moduli e lezioni.', action: { label: 'Crea la struttura', run: () => setActive('content') } }
      : !allLessonsReady
        ? { text: 'Alcune lezioni non hanno ancora i contenuti.', action: { label: 'Genera i contenuti', run: () => setActive('content') } }
        : pendingTests.pendingCount > 0
          ? { text: pendingTests.pendingCount === 1 ? 'Manca 1 test.' : `Mancano ${pendingTests.pendingCount} test.`, action: pendingTests.readyCount > 0 ? { label: 'Genera i test', run: () => void handleGenerateAllTests() } : { label: 'Vedi i test', run: goToTests } }
          : !hasCover
            ? { text: 'Aggiungi una copertina al corso.', action: { label: 'Vai alle impostazioni', run: () => setActive('settings') } }
            : { text: 'Il corso è pronto: controlla l’anteprima e pubblicalo.', action: { label: 'Vai alla pubblicazione', run: () => setActive('publish') } };

  async function handleSaveBrief(brief: Brief) {
    try {
      await saveBrief.mutateAsync(brief);
      // Il preventivo mostrato nel brief diventa il budget del corso.
      await confirmBudget.mutateAsync(undefined).catch(() => undefined);
      toast.show('Impostazioni salvate', 'success');
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

  async function handleToggleShareable(next: boolean) {
    try {
      await setShareable.mutateAsync(next);
      toast.show(
        next ? 'Corso condiviso nel catalogo integrazioni' : 'Condivisione disattivata',
        'success',
      );
    } catch {
      toast.show('Impostazione non salvata', 'error');
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

  async function handleSetSpeechEngine(engine: 'standard' | 'neural' | 'generative') {
    if ((course.data?.speechEngine ?? 'neural') === engine) return;
    try {
      await updateSettings.mutateAsync({ speechEngine: engine });
      toast.show(
        engine === 'generative'
          ? 'Voce generativa (iper-realistica) applicata'
          : engine === 'neural'
            ? 'Voce neurale (qualità alta) applicata'
            : 'Voce standard (economica) applicata',
        'success',
      );
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

  async function handleSetCoverPosition(pos: number) {
    try {
      await updateSettings.mutateAsync({ coverPosition: pos });
    } catch {
      toast.show('Posizione copertina non salvata', 'error');
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

  return (
    <div className="space-y-6">
      {/* Stato del corso: una frase e la prossima azione. */}
      <div className="rounded-xl border bg-card p-4">
        {othersCourse && author && (
          <p className="mb-3 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            Corso creato da <span className="font-medium text-foreground">{author.name}</span>. Riprendi da dove era
            arrivato: le modifiche valgono per tutta l&apos;azienda.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {generationActive && (
              <span className="relative flex size-2.5 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
                <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
              </span>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold">{generationActive ? 'Generazione in corso' : `Corso completo al ${progressPct}%`}</p>
              <p className="text-sm text-muted-foreground">{next.text}</p>
            </div>
          </div>
          {next.action && (
            <Button onClick={next.action.run} disabled={pendingTests.running}>
              {next.action.label} <ChevronRight className="size-4" />
            </Button>
          )}
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        <CourseBudget courseId={courseId} className="mt-3" />
      </div>
      {/* Aree del corso */}
      <div role="tablist" aria-label="Aree del corso" className="flex gap-1 border-b">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(t.id)}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition',
                isActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-4" /> {t.title}
              {t.id === 'content' && pendingTests.pendingCount > 0 && hasStructure && (
                <span className="rounded-full bg-amber-500/20 px-1.5 text-xs text-amber-900 dark:text-amber-200">{pendingTests.pendingCount} test</span>
              )}
            </button>
          );
        })}
      </div>

      {active === 'content' && (
        <section className="space-y-4">
          {!hasStructure ? (
            <>
              <p className="text-sm text-muted-foreground">Genera moduli e lezioni dalle impostazioni del corso, oppure aggiungili a mano.</p>
              <CourseBuilder courseId={courseId} mode="structure" autoOpenSlides={autoOpenSlides} />
            </>
          ) : (
            <>
              <CourseBuilder courseId={courseId} mode="content" highlightTests={highlightTests} />
              <details className="rounded-lg border bg-muted/20" onToggle={(e) => setStructureOpen((e.currentTarget as HTMLDetailsElement).open)}>
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground">
                  Modifica moduli e lezioni
                  <ChevronDown className="size-4" />
                </summary>
                {structureOpen && (
                  <div className="border-t p-4">
                    <CourseBuilder courseId={courseId} mode="structure" />
                  </div>
                )}
              </details>
            </>
          )}
        </section>
      )}

      {active === 'settings' && (
        <section className="space-y-4">
          <SettingsSection title="Informazioni e obiettivi" hint="Titolo, pubblico, lingua, test richiesti e fonti usate per generare." defaultOpen={!hasBrief}>
            <BriefWizard
              layout="page"
              courseId={courseId}
              initial={course.data?.brief ?? undefined}
              defaultTitle={course.data?.title ?? ''}
              defaultLanguage={course.data?.language ?? 'it'}
              onSubmit={handleSaveBrief}
              saving={saveBrief.isPending}
            />
          </SettingsSection>
          <SettingsSection title="Fonti del corso" hint="I contenuti su cui è costruito il corso: scaricali o rimuovili.">
            <CourseSourcesPanel courseId={courseId} />
          </SettingsSection>
          <SettingsSection title="Aspetto" hint="Copertina, brand, docente, stile e voce." defaultOpen={hasBrief && !hasCover}>
            <div className="space-y-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-xl border bg-card">
            {course.data?.coverImageUrl ? (
              <>
                {/* Anteprima FEDELE: stesso rapporto del banner nel corso, con
                    il punto focale applicato → è esattamente ciò che si vedrà. */}
                {/* eslint-disable-next-line @next/next/no-img-element -- URL firmato dinamico */}
                <img
                  src={course.data.coverImageUrl}
                  alt={`Copertina: ${course.data.title}`}
                  className="w-full object-cover"
                  style={{ aspectRatio: String(COVER_ASPECT), objectPosition: `50% ${coverPos}%` }}
                />
                {/* Strumento di inquadratura: mostra l'immagine INTERA con la
                    finestra "Visibile nel corso" evidenziata; il resto è oscurato. */}
                <div className="border-t p-3">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Trascina lo slider o la finestra per scegliere cosa mostrare nel banner del corso.
                  </p>
                  <CoverFramer
                    src={course.data.coverImageUrl}
                    value={coverPos}
                    onChange={setCoverPos}
                    onCommit={handleSetCoverPosition}
                  />
                </div>
              </>
            ) : (
              <div className="flex w-full flex-col items-center justify-center gap-3 bg-muted/40 text-center" style={{ aspectRatio: String(COVER_ASPECT) }}>
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
                {attachStockCover.isPending ? 'Imposto…' : 'Unsplash o dal PC'}
              </Button>
              <Button variant="outline" size="sm" onClick={handleGenerateCover} disabled={genCover.isPending}>
                <ImageIcon className="size-4" />
                {genCover.isPending ? 'Generazione…' : course.data?.coverImageUrl ? 'Rigenera copertina' : 'Genera copertina'}
                {!genCover.isPending && <CreditCost items={[{ feature: 'image_generation', units: 1 }]} />}
              </Button>
            </div>
          </div>

          <StockPhotoPicker
            open={coverStockOpen}
            courseId={courseId}
            title="Scegli la copertina (Unsplash o dal tuo PC)"
            saving={attachStockCover.isPending || uploadCover.isPending}
            onClose={() => setCoverStockOpen(false)}
            onUpload={async (file) => {
              try {
                await uploadCover.mutateAsync(file);
                toast.show('Copertina caricata', 'success');
                setCoverStockOpen(false);
              } catch (err) {
                toast.show(
                  err instanceof Error && /\b(413|troppo grand|too large)\b/i.test(err.message)
                    ? 'Immagine troppo grande (max 8MB)'
                    : 'Caricamento copertina non riuscito',
                  'error',
                );
              }
            }}
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

          <SpeechEnginePicker
            value={course.data?.speechEngine ?? 'neural'}
            onChange={handleSetSpeechEngine}
            saving={updateSettings.isPending}
          />
            </div>
          </SettingsSection>
        </section>
      )}

      {active === 'publish' && (
        <section className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-muted-foreground">Controlla il risultato, poi scarica il pacchetto SCORM.</p>
            <ExportDialog courseId={courseId} />
          </div>
          <CoursePreview courseId={courseId} />
          {/* Costo: lo vede chi paga il corso. */}
          <details className="group rounded-lg border bg-card" open>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-sm font-medium">
              {creditsOn ? 'Crediti usati per questo corso' : 'Costo del corso'}
              <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t p-4">
              <CoursePricingPanel courseId={courseId} />
            </div>
          </details>
          <details className="group rounded-lg border bg-muted/20">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground">
              Opzioni avanzate: condivisione con altre piattaforme
              <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t p-4">
              <ShareablePanel
                shareable={course.data?.shareable ?? false}
                approved={course.data?.status === 'APPROVED'}
                saving={setShareable.isPending}
                onToggle={handleToggleShareable}
              />
            </div>
          </details>
        </section>
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

/**
 * Scelta del motore di sintesi vocale (Amazon Polly) per la narrazione del
 * corso: 'standard' (economico) o 'neural' (qualità superiore, più costoso).
 * È la preferenza del corso; al momento della generazione si può comunque
 * forzare un engine diverso per quella singola narrazione.
 */
function SpeechEnginePicker({
  value,
  onChange,
  saving,
}: {
  value: 'standard' | 'neural' | 'generative';
  onChange: (engine: 'standard' | 'neural' | 'generative') => void;
  saving?: boolean;
}) {
  const options: Array<{ id: 'standard' | 'neural' | 'generative'; title: string; desc: string }> = [
    { id: 'standard', title: 'Standard', desc: 'Voce sintetica più semplice. Costo contenuto: ideale per bozze o grandi volumi.' },
    { id: 'neural', title: 'Neurale', desc: 'Voce molto più naturale e fluida. Costa circa 4× la standard. Consigliata per la pubblicazione.' },
    { id: 'generative', title: 'Generativa', desc: 'Voce iper-realistica, quasi umana (massima qualità). Per i video-lezione i sottotitoli restano sincronizzati.' },
  ];
  return (
    <fieldset className="rounded-xl border bg-card p-4" disabled={saving}>
      <legend className="px-1 text-sm font-medium">Voce della narrazione</legend>
      <p className="mb-3 text-xs text-muted-foreground">
        Qualità della voce per l&apos;audio generato dal testo delle lezioni. Puoi comunque
        scegliere un&apos;altra voce al momento di generare la singola narrazione.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
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
 * Pannello di condivisione verso il catalogo integrazioni (B2B). Il corso è
 * reso disponibile alle piattaforme terze autorizzate (es. OnDemand) solo se
 * l'opt-in è attivo E lo stato editoriale è APPROVED: lo spieghiamo in chiaro.
 */
function ShareablePanel({
  shareable,
  approved,
  saving,
  onToggle,
}: {
  shareable: boolean;
  approved: boolean;
  saving?: boolean;
  onToggle: (next: boolean) => void;
}) {
  const live = shareable && approved;
  return (
    <fieldset className="rounded-xl border bg-card p-4" disabled={saving}>
      <legend className="px-1 text-sm font-medium">Condivisione catalogo integrazioni</legend>
      <p className="mb-3 text-xs text-muted-foreground">
        Rende il corso disponibile al download (pacchetto SCORM) per le piattaforme terze
        autorizzate dal tuo workspace. Diventa effettivo solo quando il corso è anche
        <span className="font-medium"> approvato</span>.
      </p>
      <div className="flex items-center justify-between gap-4">
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary,#4f46e5)]"
            checked={shareable}
            onChange={(e) => onToggle(e.target.checked)}
            aria-label="Condividi nel catalogo integrazioni"
          />
          <span>Condividi questo corso nel catalogo</span>
        </label>
        <span
          className={cn(
            'rounded-full px-2.5 py-1 text-xs font-medium',
            live
              ? 'bg-emerald-100 text-emerald-700'
              : shareable
                ? 'bg-amber-100 text-amber-700'
                : 'bg-muted text-muted-foreground',
          )}
        >
          {live ? 'Nel catalogo' : shareable ? 'In attesa di approvazione' : 'Privato'}
        </span>
      </div>
      {shareable && !approved && (
        <p className="mt-3 text-xs text-amber-700">
          Il corso è marcato come condivisibile ma non è ancora approvato: non sarà visibile alle
          integrazioni finché lo stato non diventa «Approvato».
        </p>
      )}
    </fieldset>
  );
}

/** Sezione richiudibile della scheda Impostazioni. */
function SettingsSection({ title, hint, defaultOpen, children }: { title: string; hint: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details className="group rounded-xl border bg-card" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span>
          <span className="block text-sm font-semibold">{title}</span>
          <span className="block text-xs text-muted-foreground">{hint}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t p-4">{children}</div>
    </details>
  );
}
