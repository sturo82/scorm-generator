'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Sparkles, Wand2, Trash2, Pencil, Image as ImageIcon, Volume2, Video, Captions, Search, Check, ChevronRight, Eye, UserRound, Film, Clapperboard } from 'lucide-react';
import type { Block } from '@scorm/contracts';
import {
  DEFAULT_HEYGEN_ENGINE,
  heygenCustomerPricePerMinUsd,
  heygenAvatarTypeLabel,
} from '@scorm/contracts';
import { cn } from '@/lib/cn';
import type { ModuleView, LessonView } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { TranscriptEditorDialog } from '@/components/courses/transcript-editor-dialog';
import { EditorialStatusBadge } from '@/components/status-badge';
import { BlockPreview } from '@/components/courses/block-preview';
import { BlockEditorDialog } from '@/components/courses/block-editor-dialog';
import { StockPhotoPicker } from '@/components/courses/stock-photo-picker';
import { useToast } from '@/components/ui/toast';
import {
  useModules,
  useAddModule,
  useAddLesson,
  useDeleteModule,
  useDeleteLesson,
  useGenerateOutline,
  useGenerateLessonContent,
  useGenerateAllContent,
  useGenerateLessonImages,
  useGenerateLessonNarration,
  useUploadLessonVideo,
  useAttachVideoFromLibrary,
  useSetVideoTranscript,
  useRetranscribeVideo,
  useVideoAvatars,
  useVideoVoices,
  useGenerateConceptVideo,
  useGenerateScenesCartoon,
  useAttachStockImage,
  useUploadBlockImage,
  useVideos,
  useActiveJobs,
  useEditLessonBlocks,
  useSetStatus,
  useSetStatusAll,
  useSetLessonFormat,
  useJobStatus,
  useAssessments,
  useDeleteAssessment,
  useGenerateAssessment,
  useRepairAssessments,
  qk,
} from '@/lib/api/hooks';
import { AiWorking, AiWorkingInline } from '@/components/courses/ai-working';
import { usePendingAssessments } from '@/lib/use-pending-assessments';
import type { EditorialStatus } from '@/lib/api/types';

/**
 * mode:
 *  - 'structure': genera la struttura (outline + materializzazione automatica) e
 *    permette di editare moduli/lezioni. Non mostra la generazione contenuti.
 *  - 'content': genera i contenuti (singoli o tutti) delle lezioni esistenti.
 */
export function CourseBuilder({
  courseId,
  mode = 'content',
  highlightTests = false,
}: {
  courseId: string;
  mode?: 'structure' | 'content';
  /** Evidenzia la card dei test (navigazione dal banner "test da generare"). */
  highlightTests?: boolean;
}) {
  const modules = useModules(courseId);
  const addModule = useAddModule(courseId);
  const genOutline = useGenerateOutline(courseId);
  const qc = useQueryClient();
  const toast = useToast();
  const [newModuleTitle, setNewModuleTitle] = React.useState('');
  const [outlineJobId, setOutlineJobId] = React.useState<string | null>(null);
  // Accordion moduli (modalità struttura): uno aperto per volta.
  const [openStructModuleId, setOpenStructModuleId] = React.useState<string | null>(null);

  // Polling del job di generazione struttura: alla fine ricarica i moduli.
  const outlineJob = useJobStatus(courseId, outlineJobId);
  React.useEffect(() => {
    const status = outlineJob.data?.status;
    if (!outlineJobId || !status) return;
    if (status === 'COMPLETED') {
      setOutlineJobId(null);
      qc.invalidateQueries({ queryKey: qk.modules(courseId) });
      qc.invalidateQueries({ queryKey: qk.course(courseId) });
      toast.show('Struttura generata', 'success');
    } else if (status === 'FAILED') {
      setOutlineJobId(null);
      toast.show(outlineJob.data?.error ?? 'Generazione struttura non riuscita', 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlineJob.data?.status]);

  const hasStructure = (modules.data?.length ?? 0) > 0;
  const generatingStructure = Boolean(outlineJobId);

  async function handleGenerateStructure() {
    try {
      const { jobId } = await genOutline.mutateAsync();
      setOutlineJobId(jobId);
    } catch {
      toast.show('Avvio generazione non riuscito', 'error');
    }
  }

  async function handleAddModule(e: React.FormEvent) {
    e.preventDefault();
    if (!newModuleTitle.trim()) return;
    await addModule.mutateAsync({ title: newModuleTitle.trim() });
    setNewModuleTitle('');
  }

  // --- Modalità STRUTTURA ---------------------------------------------------
  if (mode === 'structure') {
    return (
      <div className="space-y-6">
        <Card className="border-primary/20 bg-accent/30">
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
                <Sparkles className="size-5" />
              </div>
              <div>
                <p className="font-medium">Struttura assistita</p>
                <p className="text-sm text-muted-foreground">
                  Dal brief genero l’outline e creo automaticamente moduli e lezioni. Potrai
                  modificarli subito dopo.
                </p>
              </div>
            </div>
            {!generatingStructure && (
              <Button onClick={handleGenerateStructure} disabled={genOutline.isPending}>
                <Wand2 className="size-4" />
                {hasStructure ? 'Rigenera struttura' : 'Genera struttura'}
              </Button>
            )}
          </CardContent>
        </Card>

        {generatingStructure && (
          <AiWorking
            label="Sto creando la struttura del corso…"
            hint="Genero l’outline dal brief e materializzo moduli e lezioni. Richiede qualche istante."
          />
        )}

        {/* La struttura compare solo quando esiste (dopo la generazione) */}
        {hasStructure && (
          <div>
            <h3 className="mb-3 text-lg font-semibold">Struttura del corso</h3>
            <div className="space-y-3">
              {modules.data?.map((m, i) => (
                <ModuleCard
                  key={m.id}
                  courseId={courseId}
                  module={m}
                  moduleIndex={i}
                  editableLessons
                  open={openStructModuleId === m.id}
                  onToggle={() => setOpenStructModuleId((cur) => (cur === m.id ? null : m.id))}
                />
              ))}
            </div>
            <form onSubmit={handleAddModule} className="mt-4 flex gap-2">
              <Input
                value={newModuleTitle}
                onChange={(e) => setNewModuleTitle(e.target.value)}
                placeholder="Aggiungi un modulo a mano"
              />
              <Button type="submit" variant="outline" disabled={addModule.isPending || !newModuleTitle.trim()}>
                <Plus className="size-4" /> Modulo
              </Button>
            </form>
          </div>
        )}

        {!hasStructure && !generatingStructure && (
          <p className="text-sm text-muted-foreground">
            Nessuna struttura ancora. Premi «Genera struttura» per crearla dal brief.
          </p>
        )}
      </div>
    );
  }

  // --- Modalità CONTENUTI ---------------------------------------------------
  return <ContentBuilder courseId={courseId} highlightTests={highlightTests} />;
}

/**
 * Step contenuti: genera i contenuti di tutte le lezioni in un colpo (job a
 * cascata) con avanzamento, oppure di una singola lezione come override.
 */
function ContentBuilder({ courseId, highlightTests = false }: { courseId: string; highlightTests?: boolean }) {
  const modules = useModules(courseId);
  const genAll = useGenerateAllContent(courseId);
  const approveAll = useSetStatusAll(courseId);
  const activeJobs = useActiveJobs(courseId);
  const qc = useQueryClient();
  const toast = useToast();
  // Accordion moduli: uno aperto per volta (null = tutti chiusi).
  const [openModuleId, setOpenModuleId] = React.useState<string | null>(null);

  // Job batch "genera tutti": vive sul server. Il jobId è idratato dai job
  // attivi del corso, così dopo un reload/navigazione lo stato viene ripreso.
  const [batchJobId, setBatchJobId] = React.useState<string | null>(null);
  const serverBatch = React.useMemo(
    () => activeJobs.data?.find((j) => j.type === 'course.generate_all_content') ?? null,
    [activeJobs.data],
  );
  // Idrata il jobId batch dal server (ripresa stato) se non già noto localmente.
  React.useEffect(() => {
    if (serverBatch && !batchJobId) setBatchJobId(serverBatch.id);
  }, [serverBatch, batchJobId]);

  const batchJob = useJobStatus(courseId, batchJobId);
  const batchActive =
    Boolean(serverBatch) ||
    (Boolean(batchJobId) && (batchJob.data?.status === 'QUEUED' || batchJob.data?.status === 'RUNNING'));

  // Alla fine del batch: ricarica i contenuti e notifica una volta sola.
  const prevBatchStatus = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    const status = batchJob.data?.status;
    if (!batchJobId || !status) return;
    if (status !== prevBatchStatus.current && (status === 'COMPLETED' || status === 'FAILED')) {
      qc.invalidateQueries({ queryKey: qk.modules(courseId) });
      qc.invalidateQueries({ queryKey: ['jobs', 'active-all'] });
      if (status === 'COMPLETED') toast.show('Generazione contenuti completata', 'success');
      else toast.show(batchJob.data?.error ?? 'Generazione completata con errori', 'error');
      setBatchJobId(null);
    }
    prevBatchStatus.current = status;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchJob.data?.status]);

  const allLessons = React.useMemo(
    () => (modules.data ?? []).flatMap((m) => m.lessons.map((l) => ({ moduleId: m.id, lesson: l }))),
    [modules.data],
  );
  const total = allLessons.length;
  const withContent = allLessons.filter(({ lesson }) => lesson.blocks.length > 0).length;
  const pendingCount = total - withContent;
  // Tutto approvato se ogni modulo e ogni lezione sono APPROVED (per abilitare
  // il bottone "Approva tutto" solo quando c'è davvero qualcosa da approvare).
  const allApproved = React.useMemo(() => {
    const mods = modules.data ?? [];
    if (mods.length === 0) return false;
    return mods.every(
      (m) => m.status === 'APPROVED' && m.lessons.every((l) => l.status === 'APPROVED'),
    );
  }, [modules.data]);

  // Mentre il batch gira, ricarica periodicamente i moduli per mostrare le
  // lezioni che completano una ad una (avanzamento incrementale).
  React.useEffect(() => {
    if (!batchActive) return;
    const t = setInterval(() => qc.invalidateQueries({ queryKey: qk.modules(courseId) }), 2500);
    return () => clearInterval(t);
  }, [batchActive, courseId, qc]);

  async function handleGenerateAll() {
    try {
      const { jobId } = await genAll.mutateAsync();
      setBatchJobId(jobId);
      qc.invalidateQueries({ queryKey: ['jobs', 'active-all'] });
      toast.show('Generazione avviata: continua anche se chiudi la pagina', 'success');
    } catch {
      toast.show('Avvio generazione non riuscito', 'error');
    }
  }

  async function handleApproveAll() {
    try {
      const r = await approveAll.mutateAsync('APPROVED');
      toast.show(
        `Approvati: ${r.modules} moduli, ${r.lessons} lezioni` +
          (r.assessments ? `, ${r.assessments} test` : ''),
        'success',
      );
    } catch {
      toast.show('Approvazione non riuscita', 'error');
    }
  }

  if (modules.isLoading) return <Skeleton className="h-28 w-full" />;
  if (!modules.data || modules.data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nessuna struttura. Torna allo step «Struttura» e genera moduli e lezioni.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-accent/30">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-5" />
            </div>
            <div>
              <p className="font-medium">Contenuti assistiti</p>
              <p className="text-sm text-muted-foreground">
                Genero i contenuti di tutte le lezioni in un&apos;unica operazione sul server:
                prosegue anche se ricarichi o cambi pagina. Puoi anche generarli (o rigenerarli)
                una lezione alla volta qui sotto.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              variant="outline"
              onClick={handleApproveAll}
              disabled={approveAll.isPending || batchActive || allApproved}
              title={allApproved ? 'Tutti i moduli e le lezioni sono già approvati' : 'Approva in blocco moduli, lezioni e test'}
            >
              <Check className="size-4" />
              {approveAll.isPending ? 'Approvazione…' : allApproved ? 'Tutto approvato' : 'Approva tutto'}
            </Button>
            <Button onClick={handleGenerateAll} disabled={batchActive || pendingCount === 0}>
              <Wand2 className="size-4" />
              {batchActive ? 'Generazione in corso…' : `Genera tutti i contenuti (${pendingCount})`}
            </Button>
          </div>
        </CardContent>
      </Card>

      {batchActive && (
        <AiWorking
          label={`Sto generando i contenuti del corso… ${withContent}/${total} lezioni pronte`}
          hint="La generazione gira sul server: puoi ricaricare la pagina o navigare altrove senza interromperla."
        />
      )}

      <div className="space-y-3">
        {modules.data.map((m, i) => (
          <ModuleCard
            key={m.id}
            courseId={courseId}
            module={m}
            moduleIndex={i}
            batchActive={batchActive}
            open={openModuleId === m.id}
            onToggle={() => setOpenModuleId((cur) => (cur === m.id ? null : m.id))}
          />
        ))}
      </div>

      <AssessmentManager courseId={courseId} modules={modules.data} highlight={highlightTests} />
    </div>
  );
}

/**
 * Gestione dei test del corso: elenca gli assessment (collegandoli al modulo),
 * permette di eliminarli e di (ri)generare un test intermedio per modulo o il
 * test finale. Utile per correggere corsi con test orfani (moduleId mancante)
 * o per aggiungerne di nuovi senza rigenerare tutti i contenuti.
 */
function AssessmentManager({
  courseId,
  modules,
  highlight = false,
}: {
  courseId: string;
  modules: ModuleView[];
  /** Evidenzia la card (es. quando si arriva qui dal banner "test da generare"). */
  highlight?: boolean;
}) {
  const assessments = useAssessments(courseId);
  const del = useDeleteAssessment(courseId);
  const gen = useGenerateAssessment(courseId);
  const repair = useRepairAssessments(courseId);
  const pendingAssessments = usePendingAssessments(courseId, modules);
  const toast = useToast();
  const qc = useQueryClient();
  const [jobId, setJobId] = React.useState<string | null>(null);
  const job = useJobStatus(courseId, jobId);

  React.useEffect(() => {
    const status = job.data?.status;
    if (!jobId || !status) return;
    if (status === 'COMPLETED' || status === 'FAILED') {
      setJobId(null);
      qc.invalidateQueries({ queryKey: ['courses', courseId, 'assessments'] });
      toast.show(
        status === 'COMPLETED' ? 'Test generato' : (job.data?.error ?? 'Generazione test non riuscita'),
        status === 'COMPLETED' ? 'success' : 'error',
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.data?.status]);

  const generating = Boolean(jobId) || pendingAssessments.running;
  const list = assessments.data ?? [];
  const orphanCount = list.filter((a) => a.scope === 'intermediate' && !a.moduleId).length;

  async function handleRepair() {
    try {
      const r = await repair.mutateAsync();
      toast.show(
        `Test riparati: ${r.linked} collegati${r.removedDuplicates ? `, ${r.removedDuplicates} duplicati rimossi` : ''}`,
        'success',
      );
    } catch {
      toast.show('Riparazione non riuscita', 'error');
    }
  }
  const moduleTitleById = React.useMemo(() => {
    const map: Record<string, string> = {};
    modules.forEach((m) => (map[m.id] = m.title));
    return map;
  }, [modules]);

  // Moduli senza un test intermedio collegato (per il bottone "genera").
  const modulesWithIntermediate = new Set(
    list.filter((a) => a.scope === 'intermediate' && a.moduleId).map((a) => a.moduleId),
  );
  const hasFinal = list.some((a) => a.scope === 'final');

  // I test si basano sul contenuto delle lezioni (RAG): un modulo è "pronto"
  // solo se ha almeno una lezione con contenuti; il finale solo se tutte le
  // lezioni del corso hanno contenuti.
  const moduleHasContent = (m: ModuleView) => m.lessons.some((l) => l.blocks.length > 0);
  const allLessonsOfCourse = modules.flatMap((m) => m.lessons);
  const finalReady =
    allLessonsOfCourse.length > 0 && allLessonsOfCourse.every((l) => l.blocks.length > 0);

  async function handleGenerate(scope: 'intermediate' | 'final', moduleId?: string) {
    try {
      const { jobId: id } = await gen.mutateAsync({ scope, moduleId });
      setJobId(id);
      toast.show('Generazione test avviata…', 'success');
    } catch {
      toast.show('Avvio generazione test non riuscito', 'error');
    }
  }

  async function handleGenerateAllPending() {
    try {
      const started = await pendingAssessments.generateAllPending();
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

  const pendingCount = pendingAssessments.pendingCount;
  const readyCount = pendingAssessments.readyCount;
  const blockedCount = pendingAssessments.blockedCount;
  const batchRunning = pendingAssessments.running;

  async function handleDelete(assessmentId: string) {
    try {
      await del.mutateAsync(assessmentId);
      toast.show('Test eliminato', 'success');
    } catch {
      toast.show('Eliminazione non riuscita', 'error');
    }
  }

  return (
    <Card
      id="course-tests"
      className={cn('scroll-mt-24', highlight && 'ring-2 ring-primary/60')}
    >
      <CardHeader className="flex-col items-start gap-2 space-y-0 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="text-base">Test del corso</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {pendingCount === 0
              ? modules.length === 0
                ? 'Genera prima la struttura del corso'
                : 'Tutti i test sono stati generati'
              : readyCount > 0
                ? `${pendingCount} da generare · ${readyCount} pronti` +
                  (blockedCount > 0 ? ` · ${blockedCount} in attesa dei contenuti` : '')
                : `${pendingCount} da generare · genera prima i contenuti delle lezioni`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {orphanCount > 0 && (
            <Button size="sm" variant="outline" onClick={handleRepair} disabled={repair.isPending || batchRunning}>
              <Check className="size-4" />
              {repair.isPending ? 'Riparazione…' : `Correggi test orfani (${orphanCount})`}
            </Button>
          )}
          {(readyCount > 0 || batchRunning) && (
            <Button
              size="sm"
              onClick={handleGenerateAllPending}
              disabled={batchRunning || generating}
              title="Genera i test pronti (il cui contenuto esiste già) in un job sul server"
            >
              <Wand2 className="size-4" />
              {batchRunning ? 'Generazione…' : `Genera ${readyCount} pronti`}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          I test intermedi bloccano l&apos;avanzamento finché non sono superati; il test finale
          determina l&apos;esito del corso. Un test intermedio deve essere collegato al suo modulo.
        </p>

        {batchRunning && (
          <AiWorking
            label="Sto generando i test del corso…"
            hint="La generazione gira sul server: puoi ricaricare la pagina o navigare altrove senza interromperla."
          />
        )}

        {list.length > 0 ? (
          <ul className="space-y-2">
            {list.map((a) => {
              const orphan = a.scope === 'intermediate' && !a.moduleId;
              return (
                <li key={a.id} className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.title || (a.scope === 'final' ? 'Test finale' : 'Test intermedio')}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.scope === 'final'
                        ? 'Finale'
                        : a.moduleId
                          ? `Intermedio · ${moduleTitleById[a.moduleId] ?? 'modulo'}`
                          : 'Intermedio · ⚠️ non collegato a un modulo (non blocca)'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {orphan && (
                      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-950 dark:bg-amber-400/20 dark:text-amber-200">
                        da sistemare
                      </span>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Elimina test"
                      onClick={() => handleDelete(a.id)}
                      disabled={del.isPending}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nessun test. Generane uno qui sotto.</p>
        )}

        <div className="space-y-2 border-t pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Genera un test
          </p>
          <div className="flex flex-wrap gap-2">
            {modules.map((m) => {
              const exists = modulesWithIntermediate.has(m.id);
              const noContent = !moduleHasContent(m);
              const disabled = generating || exists || noContent;
              const title = exists
                ? 'Questo modulo ha già un test intermedio'
                : noContent
                  ? 'Genera prima i contenuti delle lezioni di questo modulo'
                  : `Genera il test intermedio di "${m.title}"`;
              return (
                <Button
                  key={m.id}
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => handleGenerate('intermediate', m.id)}
                  title={title}
                >
                  <Wand2 className="size-4" />
                  {`Intermedio: ${m.title.length > 24 ? m.title.slice(0, 24) + '…' : m.title}`}
                </Button>
              );
            })}
            <Button
              size="sm"
              disabled={generating || hasFinal || !finalReady}
              onClick={() => handleGenerate('final')}
              title={
                hasFinal
                  ? 'Esiste già un test finale'
                  : !finalReady
                    ? 'Genera prima i contenuti di tutte le lezioni del corso'
                    : 'Genera il test finale del corso'
              }
            >
              <Wand2 className="size-4" />
              {generating ? 'Generazione…' : 'Test finale'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ModuleCard({
  courseId,
  module,
  moduleIndex = 0,
  editableLessons = false,
  batchActive = false,
  open = false,
  onToggle,
}: {
  courseId: string;
  module: ModuleView;
  moduleIndex?: number;
  /** Modalità struttura: consenti aggiunta/eliminazione lezioni, niente contenuti. */
  editableLessons?: boolean;
  /** Modalità contenuti: true mentre il job batch "genera tutti" è in corso. */
  batchActive?: boolean;
  /** Accordion: se il modulo è espanso. */
  open?: boolean;
  /** Accordion: toggle gestito dal parent (uno aperto per volta). */
  onToggle?: () => void;
}) {
  const addLesson = useAddLesson(courseId);
  const deleteModule = useDeleteModule(courseId);
  const setStatus = useSetStatus(courseId);
  const toast = useToast();
  const [newLesson, setNewLesson] = React.useState('');
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  // Accordion lezioni dentro il modulo: una aperta per volta.
  const [openLessonId, setOpenLessonId] = React.useState<string | null>(null);

  async function handleAddLesson(e: React.FormEvent) {
    e.preventDefault();
    if (!newLesson.trim()) return;
    await addLesson.mutateAsync({ moduleId: module.id, title: newLesson.trim() });
    setNewLesson('');
  }

  async function handleDelete() {
    try {
      await deleteModule.mutateAsync(module.id);
      toast.show('Modulo eliminato', 'success');
    } catch {
      toast.show('Eliminazione non riuscita', 'error');
    } finally {
      setConfirmOpen(false);
    }
  }

  const lessonCount = module.lessons.length;
  const withContent = module.lessons.filter((l) => l.blocks.length > 0).length;

  return (
    <Card className="overflow-hidden">
      {/* Riga header del modulo: cliccabile per espandere/comprimere. */}
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {moduleIndex + 1}. {module.title}
            </span>
            <span className="block text-xs text-muted-foreground">
              {lessonCount} {lessonCount === 1 ? 'lezione' : 'lezioni'}
              {!editableLessons && lessonCount > 0 ? ` · ${withContent}/${lessonCount} con contenuti` : ''}
            </span>
          </span>
        </button>
        <StatusControls
          status={module.status}
          onChange={(s) => setStatus.mutate({ entity: 'module', entityId: module.id, status: s })}
        />
        <Button size="icon" variant="ghost" aria-label="Elimina modulo" onClick={() => setConfirmOpen(true)}>
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>

      {open && (
        <CardContent className="space-y-2 border-t bg-muted/20 pt-3">
          {module.lessons.map((l, li) => (
            <LessonCard
              key={l.id}
              courseId={courseId}
              moduleId={module.id}
              lesson={l}
              lessonIndex={li}
              editableLessons={editableLessons}
              batchActive={batchActive}
              open={openLessonId === l.id}
              onToggle={() => setOpenLessonId((cur) => (cur === l.id ? null : l.id))}
            />
          ))}
          {editableLessons && (
            <form onSubmit={handleAddLesson} className="flex gap-2 pt-1">
              <Input
                value={newLesson}
                onChange={(e) => setNewLesson(e.target.value)}
                placeholder="Titolo della nuova lezione"
                className="h-9"
              />
              <Button type="submit" size="sm" variant="ghost" disabled={!newLesson.trim()}>
                <Plus className="size-4" /> Lezione
              </Button>
            </form>
          )}
        </CardContent>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Eliminare il modulo?"
        message={`"${module.title}" e tutte le sue lezioni verranno eliminati. L'operazione non è reversibile.`}
        loading={deleteModule.isPending}
        onConfirm={handleDelete}
        onClose={() => setConfirmOpen(false)}
      />
    </Card>
  );
}

function LessonCard({
  courseId,
  moduleId,
  lesson,
  lessonIndex = 0,
  editableLessons = false,
  batchActive = false,
  open = false,
  onToggle,
}: {
  courseId: string;
  moduleId: string;
  lesson: LessonView;
  lessonIndex?: number;
  editableLessons?: boolean;
  /** True mentre il job batch "genera tutti" è in corso sul corso. */
  batchActive?: boolean;
  /** Accordion: se la lezione è espansa. */
  open?: boolean;
  /** Accordion: toggle gestito dal parent (una aperta per volta). */
  onToggle?: () => void;
}) {
  const qc = useQueryClient();
  const genContent = useGenerateLessonContent(courseId);
  const genImages = useGenerateLessonImages(courseId);
  const genNarration = useGenerateLessonNarration(courseId);
  const uploadVideo = useUploadLessonVideo(courseId);
  const attachVideo = useAttachVideoFromLibrary(courseId);
  const attachStock = useAttachStockImage(courseId);
  const uploadImage = useUploadBlockImage(courseId);
  const setTranscript = useSetVideoTranscript(courseId);
  const retranscribe = useRetranscribeVideo(courseId);
  const deleteLesson = useDeleteLesson(courseId);
  const editBlocks = useEditLessonBlocks(courseId);
  const setStatus = useSetStatus(courseId);
  const setFormat = useSetLessonFormat(courseId);
  const toast = useToast();
  const [tone, setTone] = React.useState('');
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Block | null>(null);
  // Block con anteprima piena espansa (default: righe compatte).
  const [previewBlockId, setPreviewBlockId] = React.useState<string | null>(null);
  const videoInputRef = React.useRef<HTMLInputElement>(null);
  const [videoTargetBlock, setVideoTargetBlock] = React.useState<string | null>(null);
  // Dialog di selezione video dalla libreria (per il block video_checkpoint).
  const [libraryTargetBlock, setLibraryTargetBlock] = React.useState<string | null>(null);
  // Dialog di ricerca immagini stock (royalty-free).
  const [stockOpen, setStockOpen] = React.useState(false);
  // Inserimento immagine MIRATO su un singolo block (flusso diretto dalla riga
  // del block): quando valorizzato, il picker apre con quel solo target e un
  // termine di ricerca pre-compilato dal placeholderPrompt del block.
  const [imageTarget, setImageTarget] = React.useState<{ blockId: string; label: string; prompt?: string } | null>(null);
  // Dialog editor della trascrizione video.
  const [transcriptOpen, setTranscriptOpen] = React.useState(false);
  // Dialog di generazione video avatar (HeyGen): block target su cui generare.
  const [videoGenTargetBlock, setVideoGenTargetBlock] = React.useState<string | null>(null);
  const genConceptVideo = useGenerateConceptVideo(courseId);
  const genScenesCartoon = useGenerateScenesCartoon(courseId);
  // jobId locale per la generazione del singolo contenuto.
  const [localJobId, setLocalJobId] = React.useState<string | null>(null);
  const contentJob = useJobStatus(courseId, localJobId);
  // Generazione in corso: job singolo locale, OPPURE il batch è attivo e la
  // lezione non ha ancora contenuti (verrà generata a breve).
  const singleGenerating = Boolean(localJobId) && contentJob.data?.status !== 'FAILED';
  const generating = singleGenerating || (batchActive && lesson.blocks.length === 0);

  React.useEffect(() => {
    const status = contentJob.data?.status;
    if (!localJobId || !status) return;
    if (status === 'COMPLETED' || status === 'FAILED') {
      if (status === 'FAILED') toast.show(contentJob.data?.error ?? 'Generazione non riuscita', 'error');
      setLocalJobId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentJob.data?.status]);

  // Trova il primo block video (video_checkpoint) per abilitare l'upload.
  const videoBlock = React.useMemo(
    () => lesson.blocks.find((b) => b.type === 'video_checkpoint'),
    [lesson.blocks],
  );

  // Block con almeno un'immagine (diretta o nelle sotto-parti), per associare
  // un'immagine stock. Rispecchia la logica di findImageRef lato server.
  const imageBlocks = React.useMemo(() => collectImageBlocks(lesson.blocks), [lesson.blocks]);
  // URL del video caricato e trascrizione corrente del block video (per l'editor).
  const videoInfo = React.useMemo(() => {
    const p = (videoBlock?.payload ?? {}) as {
      video?: { storageKey?: string; source?: string };
      transcript?: Array<{ id: string; start: number; end?: number; speaker?: string; text: string }>;
    };
    const isUpload = !p.video?.source || p.video.source === 'upload';
    return {
      url: isUpload ? p.video?.storageKey ?? null : null,
      hasVideo: Boolean(p.video?.storageKey),
      transcript: p.transcript ?? [],
    };
  }, [videoBlock]);

  // La trascrizione gira in background sul server: finché lo stato è
  // 'processing' ricarichiamo i moduli periodicamente così la UI passa da
  // "in elaborazione" a "pronta"/"non riuscita" senza ricaricare la pagina.
  const transcriptProcessing =
    ((videoBlock?.payload as { transcriptStatus?: string } | undefined)?.transcriptStatus ?? '') ===
    'processing';
  React.useEffect(() => {
    if (!transcriptProcessing) return;
    const t = setInterval(() => qc.invalidateQueries({ queryKey: qk.modules(courseId) }), 4000);
    return () => clearInterval(t);
  }, [transcriptProcessing, courseId, qc]);

  // Generazione video avatar (HeyGen) in background: finché un qualsiasi block
  // video è 'processing', ricarichiamo i moduli così la UI passa da
  // "in generazione" a "pronto"/"non riuscito" senza ricaricare la pagina.
  const videoGenProcessing = React.useMemo(
    () =>
      lesson.blocks.some(
        (b) =>
          (b.payload as { videoGenStatus?: string } | undefined)?.videoGenStatus === 'processing' ||
          // Pillole: anche se una SCENA del branching_scenario è in elaborazione.
          scenarioCartoonProgress(b).processing > 0,
      ),
    [lesson.blocks],
  );
  React.useEffect(() => {
    if (!videoGenProcessing) return;
    const t = setInterval(() => qc.invalidateQueries({ queryKey: qk.modules(courseId) }), 5000);
    return () => clearInterval(t);
  }, [videoGenProcessing, courseId, qc]);

  async function handleGenerate() {
    try {
      const { jobId } = await genContent.mutateAsync({
        lessonId: lesson.id,
        toneInstruction: tone.trim() || undefined,
      });
      setLocalJobId(jobId);
    } catch {
      toast.show('Avvio generazione non riuscito', 'error');
    }
  }

  async function handleGenerateImages() {
    try {
      const r = await genImages.mutateAsync(lesson.id);
      toast.show(
        r.failed > 0
          ? `Immagini: ${r.generated} generate, ${r.failed} non riuscite`
          : `Immagini generate: ${r.generated}`,
        r.failed > 0 ? 'error' : 'success',
      );
    } catch {
      toast.show('Generazione immagini non riuscita', 'error');
    }
  }

  // Handler CONDIVISI per collegare un'immagine a un block (dal picker generale
  // o da quello mirato per-block): upload da PC o scelta stock.
  async function attachUploadToBlock(file: File, blockId: string): Promise<boolean> {
    try {
      await uploadImage.mutateAsync({ lessonId: lesson.id, blockId, file });
      toast.show('Immagine caricata e collegata', 'success');
      return true;
    } catch (err) {
      toast.show(
        err instanceof Error && /\b(413|troppo grand|too large)\b/i.test(err.message)
          ? 'Immagine troppo grande (max 8MB)'
          : 'Caricamento immagine non riuscito',
        'error',
      );
      return false;
    }
  }
  async function attachStockToBlock(
    photo: { id: string; provider: string; alt?: string },
    blockId: string,
  ): Promise<boolean> {
    try {
      await attachStock.mutateAsync({
        lessonId: lesson.id,
        input: { blockId, photoId: photo.id, provider: photo.provider, alt: photo.alt || undefined },
      });
      toast.show('Immagine stock collegata', 'success');
      return true;
    } catch (err) {
      toast.show(
        err instanceof Error && /501|non configurata/i.test(err.message)
          ? 'Libreria immagini stock non configurata sul server'
          : 'Collegamento immagine non riuscito',
        'error',
      );
      return false;
    }
  }

  async function handleGenerateNarration(engine?: 'standard' | 'neural') {
    try {
      await genNarration.mutateAsync({ lessonId: lesson.id, engine });
      toast.show(
        engine === 'neural'
          ? 'Narrazione generata (voce neurale)'
          : engine === 'standard'
            ? 'Narrazione generata (voce standard)'
            : 'Narrazione generata',
        'success',
      );
    } catch {
      toast.show('Generazione narrazione non riuscita', 'error');
    }
  }

  function pickVideo(blockId: string) {
    setVideoTargetBlock(blockId);
    videoInputRef.current?.click();
  }

  async function handleVideoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !videoTargetBlock) return;
    try {
      await uploadVideo.mutateAsync({ lessonId: lesson.id, blockId: videoTargetBlock, file });
      toast.show('Video caricato', 'success');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Caricamento video non riuscito', 'error');
    } finally {
      setVideoTargetBlock(null);
    }
  }

  async function handleDeleteLesson() {
    try {
      await deleteLesson.mutateAsync({ moduleId, lessonId: lesson.id });
      toast.show('Lezione eliminata', 'success');
    } catch {
      toast.show('Eliminazione non riuscita', 'error');
    } finally {
      setConfirmOpen(false);
    }
  }

  async function handleSaveBlock(updated: Block) {
    const nextBlocks = lesson.blocks.map((b) => (b.id === updated.id ? updated : b));
    try {
      await editBlocks.mutateAsync({
        lessonId: lesson.id,
        blocks: nextBlocks,
        expectedUpdatedAt: lesson.updatedAt,
      });
      toast.show('Block aggiornato', 'success');
      setEditing(null);
    } catch (e) {
      toast.show(
        e instanceof Error && /409|concorren/i.test(e.message)
          ? 'La lezione è stata modificata altrove: ricarica e riprova'
          : 'Salvataggio non riuscito',
        'error',
      );
    }
  }

  // Modalità struttura: titolo, FORMATO (pillola/video-first/standard), stato,
  // eliminazione. Il formato è consigliato dall'AI (lesson.format) e sempre
  // modificabile qui; aggiorna i flag derivati lato server.
  if (editableLessons) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-4 py-2">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className="truncate">{lesson.title}</span>
          {lesson.contentStale && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
              title="Il formato o altri parametri sono cambiati dopo la generazione: rigenera i contenuti per applicarli."
            >
              Da rigenerare
            </span>
          )}
        </span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Formato didattico della lezione">
            <span className="sr-only">Formato della lezione {lesson.title}</span>
            <select
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
              value={lessonFormatOf(lesson)}
              disabled={setFormat.isPending}
              onChange={(e) =>
                setFormat.mutate({
                  moduleId,
                  lessonId: lesson.id,
                  format: e.target.value as 'pillola' | 'pillola_interattiva' | 'video_first' | 'standard',
                })
              }
            >
              <option value="standard">Standard</option>
              <option value="video_first">Video-first</option>
              <option value="pillola">Pillola</option>
              <option value="pillola_interattiva">Pillola interattiva</option>
            </select>
          </label>
          {/* Rigenera i contenuti della lezione col formato/parametri CORRENTI.
              Visibile solo se la lezione ha già contenuti (altrimenti si genera
              dallo step Contenuti). Sovrascrive i block esistenti. */}
          {lesson.blocks.length > 0 && (
            <Button
              size="sm"
              variant={lesson.contentStale ? 'default' : 'outline'}
              disabled={generating}
              onClick={handleGenerate}
              title="Rigenera i contenuti di questa lezione con il formato e i parametri correnti (sovrascrive i contenuti attuali)"
            >
              <Wand2 className="size-4" />
              {generating ? 'Rigenero…' : 'Rigenera'}
            </Button>
          )}
          <StatusControls
            status={lesson.status}
            onChange={(s) => setStatus.mutate({ entity: 'lesson', entityId: lesson.id, status: s })}
          />
          <Button size="icon" variant="ghost" aria-label="Elimina lezione" onClick={() => setConfirmOpen(true)}>
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
        <ConfirmDialog
          open={confirmOpen}
          title="Eliminare la lezione?"
          message={`"${lesson.title}" verrà eliminata. L'operazione non è reversibile.`}
          loading={deleteLesson.isPending}
          onConfirm={handleDeleteLesson}
          onClose={() => setConfirmOpen(false)}
        />
      </div>
    );
  }

  const blockCount = lesson.blocks.length;

  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      {/* Riga header della lezione: cliccabile per espandere/comprimere. */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">
              Lezione {lessonIndex + 1} — {lesson.title}
            </span>
            <span className="block text-xs text-muted-foreground">
              {generating
                ? 'generazione in corso…'
                : blockCount > 0
                  ? `${blockCount} ${blockCount === 1 ? 'elemento' : 'elementi'}`
                  : 'nessun contenuto'}
            </span>
          </span>
        </button>
        {(() => {
          const fmt = lessonFormatOf(lesson);
          if (fmt === 'standard') return null;
          const label =
            fmt === 'pillola' ? 'Pillola' : fmt === 'pillola_interattiva' ? 'Pillola interattiva' : 'Video-first';
          const title =
            fmt === 'pillola'
              ? 'Micro-lezione a contenitore scorrevole (pillola)'
              : fmt === 'pillola_interattiva'
                ? 'Libro-game a scene con scelte e mini-video (pillola interattiva)'
                : 'Lezione incentrata su un video (video-first)';
          return (
            <span
              className="hidden items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary sm:inline-flex"
              title={title}
            >
              <UserRound className="size-3" /> {label}
            </span>
          );
        })()}
        {blockCount > 0 && lesson.contentStale && (
          <span
            className="hidden items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 sm:inline-flex"
            title="Il formato o altri parametri sono cambiati dopo la generazione: rigenera i contenuti per applicarli."
          >
            Da rigenerare
          </span>
        )}
        {blockCount > 0 && !lesson.contentStale && (
          <span className="hidden items-center gap-1 text-xs text-emerald-600 sm:flex" aria-hidden>
            <span className="inline-block size-1.5 rounded-full bg-emerald-500" /> pronta
          </span>
        )}
        <StatusControls
          status={lesson.status}
          onChange={(s) => setStatus.mutate({ entity: 'lesson', entityId: lesson.id, status: s })}
        />
        <Button size="icon" variant="ghost" aria-label="Elimina lezione" onClick={() => setConfirmOpen(true)}>
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>

      {!open ? null : (
      <div className="border-t bg-muted/20 p-3">

      {generating ? (
        <AiWorking label={`Sto generando i contenuti di «${lesson.title}»…`} />
      ) : lesson.blocks.length > 0 ? (
        <div className="space-y-1.5">
          {lesson.blocks.map((b) => {
            const meta = BLOCK_META[b.type] ?? { label: b.type, icon: '▪' };
            const showPreview = previewBlockId === b.id;
            return (
              <div key={b.id} className="rounded-lg border bg-background">
                {/* Riga compatta del block */}
                <div className="flex items-center gap-2 px-2.5 py-2">
                  <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-sm" aria-hidden>
                    {meta.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{meta.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{blockSummary(b)}</span>
                  </span>
                  {(() => {
                    const img = blockImageInfo(b);
                    if (img.count === 0) return null;
                    const missing = img.filled < img.count;
                    return (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={missing ? 'Inserisci immagine' : 'Sostituisci immagine'}
                        title={
                          missing
                            ? `Inserisci immagine${img.count > 1 ? ` (${img.count - img.filled} mancanti)` : ''}`
                            : 'Sostituisci immagine'
                        }
                        onClick={() => setImageTarget({ blockId: b.id, label: meta.label, prompt: img.firstPrompt })}
                      >
                        <ImageIcon className={cn('size-4', missing && 'text-primary')} />
                      </Button>
                    );
                  })()}
                  {/* Trasforma un concetto testuale in un video con avatar AI:
                      converte il block in video_checkpoint e rende la lezione
                      video-first. Mostrato solo sui concetti rich_text. */}
                  {b.type === 'rich_text' && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Trasforma in video avatar"
                      title="Trasforma questo concetto in un video con avatar AI"
                      disabled={genConceptVideo.isPending || videoGenProcessing}
                      onClick={() => setVideoGenTargetBlock(b.id)}
                    >
                      <UserRound className="size-4 text-primary" />
                    </Button>
                  )}
                  {/* Pillole: indicatore di avanzamento della generazione dei
                      cartoon delle scene. Mostra lo stato "in lavorazione N/M"
                      (con spinner) mentre le scene vengono prodotte sul server,
                      aggiornato dall'auto-refresh; oppure "pronti" a fine. */}
                  {blockHasCartoonScenes(b) &&
                    (() => {
                      const prog = scenarioCartoonProgress(b);
                      if (prog.total === 0) return null;
                      if (prog.processing > 0) {
                        return (
                          <span
                            className="flex items-center gap-1 rounded-md bg-accent/50 px-2 py-1 text-xs text-muted-foreground"
                            title="Generazione dei cartoon in corso sul server"
                          >
                            <AiWorkingInline label={`Cartoon ${prog.ready}/${prog.total}…`} />
                          </span>
                        );
                      }
                      if (prog.ready === prog.total) {
                        return (
                          <span
                            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary"
                            title="Tutti i cartoon delle scene sono pronti"
                          >
                            <Check className="size-3.5" /> Cartoon pronti
                          </span>
                        );
                      }
                      return null;
                    })()}
                  {/* Pillole: prova la generazione di UNA SOLA scena (costo
                      minimo ~1 clip). Utile per testare il provider video senza
                      produrre tutte le scene. Mostrato se c'è almeno una scena
                      con cartoon segnaposto (e nessuna già in elaborazione). */}
                  {blockHasCartoonScenes(b) &&
                    scenarioHasPendingCartoon(b) &&
                    scenarioCartoonProgress(b).processing === 0 && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Prova il cartoon di una sola scena"
                      title="Prova: genera il cartoon di una sola scena (costo minimo)"
                      disabled={genScenesCartoon.isPending}
                      onClick={async () => {
                        const nodeId = firstPendingCartoonNodeId(b);
                        if (!nodeId) {
                          toast.show('Nessuna scena da generare', 'error');
                          return;
                        }
                        try {
                          await genScenesCartoon.mutateAsync({ lessonId: lesson.id, blockId: b.id, nodeId });
                          toast.show(
                            'Generazione avviata per 1 scena: prosegue sul server ' +
                              '(la scena passa a «pronto» in qualche minuto).',
                            'success',
                          );
                        } catch (err) {
                          const msg = err instanceof Error ? err.message.replace(/^API \d+:\s*/, '') : '';
                          toast.show(msg || 'Generazione cartoon non avviata', 'error');
                        }
                      }}
                    >
                      <Clapperboard className="size-4 text-primary" />
                    </Button>
                  )}
                  {/* Pillole: genera i mini-cartoon di TUTTE le scene con video
                      segnaposto della lezione (scenari + video_checkpoint).
                      Mostrato se ci sono scene da produrre (e nessuna in corso). */}
                  {blockHasCartoonScenes(b) &&
                    scenarioHasPendingCartoon(b) &&
                    scenarioCartoonProgress(b).processing === 0 && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Genera i cartoon di tutte le scene"
                      title="Genera i mini-cartoon di tutte le scene"
                      disabled={genScenesCartoon.isPending}
                      onClick={async () => {
                        try {
                          const res = await genScenesCartoon.mutateAsync({ lessonId: lesson.id, blockId: b.id });
                          toast.show(
                            `Generazione avviata per ${res.started} scen${res.started === 1 ? 'a' : 'e'}. ` +
                              'Vedrai l\'avanzamento qui accanto (si aggiorna da solo); ogni scena richiede qualche minuto.',
                            'success',
                          );
                        } catch (err) {
                          const msg = err instanceof Error ? err.message.replace(/^API \d+:\s*/, '') : '';
                          toast.show(msg || 'Generazione cartoon non avviata', 'error');
                        }
                      }}
                    >
                      <Film className="size-4 text-primary" />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={showPreview ? 'Nascondi anteprima' : 'Mostra anteprima'}
                    title={showPreview ? 'Nascondi anteprima' : 'Mostra anteprima'}
                    onClick={() => setPreviewBlockId((cur) => (cur === b.id ? null : b.id))}
                  >
                    <Eye className={cn('size-4', showPreview && 'text-primary')} />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="Modifica block" title="Modifica" onClick={() => setEditing(b)}>
                    <Pencil className="size-4" />
                  </Button>
                </div>
                {/* Anteprima piena su richiesta */}
                {showPreview && (
                  <div className="border-t p-2">
                    <BlockPreview
                      block={b}
                      onUploadVideo={b.type === 'video_checkpoint' ? pickVideo : undefined}
                      onEditTranscript={b.type === 'video_checkpoint' ? () => setTranscriptOpen(true) : undefined}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mb-3 text-sm text-muted-foreground">Nessun contenuto ancora.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          placeholder="Istruzione opzionale (es. tono più formale)"
          className="h-9 max-w-xs"
          disabled={generating}
        />
        <Button size="sm" onClick={handleGenerate} disabled={generating}>
          <Wand2 className="size-4" />
          {generating ? 'Generazione…' : lesson.blocks.length ? 'Rigenera' : 'Genera contenuti'}
        </Button>
        {lesson.blocks.length > 0 && !generating && (
          <>
            <Button size="sm" variant="outline" onClick={handleGenerateImages} disabled={genImages.isPending}>
              <ImageIcon className="size-4" />
              {genImages.isPending ? <AiWorkingInline label="Immagini…" /> : 'Genera immagini'}
            </Button>
            {imageBlocks.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setStockOpen(true)}
                disabled={attachStock.isPending}
              >
                <Search className="size-4" />
                {attachStock.isPending ? <AiWorkingInline label="Collego…" /> : 'Immagini stock'}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleGenerateNarration()}
              disabled={genNarration.isPending}
              title="Genera la narrazione usando la voce impostata per il corso"
            >
              <Volume2 className="size-4" />
              {genNarration.isPending ? <AiWorkingInline label="Narrazione…" /> : 'Genera narrazione'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleGenerateNarration('neural')}
              disabled={genNarration.isPending}
              title="Genera questa narrazione con la voce neurale (qualità superiore, più costosa)"
            >
              <Volume2 className="size-4 text-primary" />
              Voce HD
            </Button>
            {videoBlock && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => pickVideo(videoBlock.id)}
                  disabled={uploadVideo.isPending}
                >
                  <Video className="size-4" />
                  {uploadVideo.isPending ? <AiWorkingInline label="Carico…" /> : 'Carica video'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setLibraryTargetBlock(videoBlock.id)}
                  disabled={attachVideo.isPending}
                >
                  <Video className="size-4" />
                  {attachVideo.isPending ? <AiWorkingInline label="Collego…" /> : 'Dalla libreria'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setVideoGenTargetBlock(videoBlock.id)}
                  disabled={genConceptVideo.isPending || videoGenProcessing}
                >
                  <UserRound className="size-4" />
                  {genConceptVideo.isPending || videoGenProcessing ? (
                    <AiWorkingInline label="Video avatar…" />
                  ) : (
                    'Genera video avatar'
                  )}
                </Button>
                {videoInfo.hasVideo && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await retranscribe.mutateAsync({ lessonId: lesson.id, blockId: videoBlock!.id });
                          toast.show('Trascrizione avviata…', 'success');
                        } catch (err) {
                          toast.show(
                            err instanceof Error && /501|non configurat/i.test(err.message)
                              ? 'Trascrizione automatica non configurata sul server'
                              : 'Avvio trascrizione non riuscito',
                            'error',
                          );
                        }
                      }}
                      disabled={retranscribe.isPending || transcriptProcessing}
                    >
                      <Captions className="size-4" />
                      {retranscribe.isPending || transcriptProcessing ? (
                        <AiWorkingInline label="Trascrivo…" />
                      ) : (
                        'Rigenera trascrizione'
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setTranscriptOpen(true)}
                      disabled={setTranscript.isPending}
                    >
                      <Captions className="size-4" />
                      {setTranscript.isPending ? <AiWorkingInline label="Salvo…" /> : 'Modifica trascrizione'}
                    </Button>
                  </>
                )}
              </>
            )}
          </>
        )}
        {/* Input file nascosto per l'upload del video (MP4/WebM, max 100MB). */}
        <input
          ref={videoInputRef}
          type="file"
          accept="video/mp4,video/webm"
          className="hidden"
          onChange={handleVideoFile}
        />
      </div>

      {lesson.narrationUrl && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Narrazione audio</p>
          <audio controls src={lesson.narrationUrl} className="w-full max-w-md">
            Il tuo browser non supporta l&apos;audio.
          </audio>
        </div>
      )}
      </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Eliminare la lezione?"
        message={`"${lesson.title}" e i suoi contenuti verranno eliminati. L'operazione non è reversibile.`}
        loading={deleteLesson.isPending}
        onConfirm={handleDeleteLesson}
        onClose={() => setConfirmOpen(false)}
      />

      <BlockEditorDialog
        open={!!editing}
        block={editing}
        saving={editBlocks.isPending}
        onClose={() => setEditing(null)}
        onSave={handleSaveBlock}
      />

      <VideoLibraryDialog
        open={!!libraryTargetBlock}
        saving={attachVideo.isPending}
        onClose={() => setLibraryTargetBlock(null)}
        onSelect={async (videoAssetId) => {
          if (!libraryTargetBlock) return;
          try {
            await attachVideo.mutateAsync({ lessonId: lesson.id, blockId: libraryTargetBlock, videoAssetId });
            toast.show('Video collegato dalla libreria', 'success');
            setLibraryTargetBlock(null);
          } catch {
            toast.show('Collegamento non riuscito', 'error');
          }
        }}
      />

      <GenerateAvatarVideoDialog
        key={videoGenTargetBlock ?? 'closed'}
        open={!!videoGenTargetBlock}
        courseId={courseId}
        saving={genConceptVideo.isPending}
        onClose={() => setVideoGenTargetBlock(null)}
        onGenerate={async ({ avatarId, voiceId, script }) => {
          if (!videoGenTargetBlock) return;
          try {
            const res = await genConceptVideo.mutateAsync({
              lessonId: lesson.id,
              blockId: videoGenTargetBlock,
              avatarId,
              voiceId,
              script,
            });
            toast.show(
              `Generazione avviata: la lezione diventa video-first. Video rimanenti questo mese: ${res.remainingThisMonth}.`,
              'success',
            );
            setVideoGenTargetBlock(null);
          } catch (err) {
            toast.show(
              err instanceof Error && /501|non configurat/i.test(err.message)
                ? 'Generazione video non configurata sul server (HeyGen)'
                : err instanceof Error && /quota|esaurit|3 video/i.test(err.message)
                  ? 'Quota mensile HeyGen esaurita (3 video/mese)'
                  : 'Avvio generazione video non riuscito',
              'error',
            );
          }
        }}
      />

      {/* Picker GENERALE (dal pulsante della lezione): mostra il selettore del
          block di destinazione. */}
      <StockPhotoPicker
        open={stockOpen}
        courseId={courseId}
        targets={imageBlocks}
        saving={attachStock.isPending || uploadImage.isPending}
        onClose={() => setStockOpen(false)}
        onUpload={async (file, blockId) => {
          if (!blockId) return;
          if (await attachUploadToBlock(file, blockId)) setStockOpen(false);
        }}
        onSelect={async (photo, blockId) => {
          if (!blockId) return;
          if (await attachStockToBlock(photo, blockId)) setStockOpen(false);
        }}
      />

      {/* Picker MIRATO (dal pulsante immagine della singola riga block): nessun
          selettore di destinazione (target già scelto) e ricerca precompilata
          dalla descrizione del placeholder → inserimento diretto e intuitivo. */}
      <StockPhotoPicker
        open={!!imageTarget}
        courseId={courseId}
        title={imageTarget ? `Immagine per: ${imageTarget.label}` : 'Immagine'}
        targets={imageTarget ? [{ id: imageTarget.blockId, label: imageTarget.label, count: 1 }] : []}
        initialQuery={imageTarget?.prompt}
        saving={attachStock.isPending || uploadImage.isPending}
        onClose={() => setImageTarget(null)}
        onUpload={async (file) => {
          if (!imageTarget) return;
          if (await attachUploadToBlock(file, imageTarget.blockId)) setImageTarget(null);
        }}
        onSelect={async (photo) => {
          if (!imageTarget) return;
          if (await attachStockToBlock(photo, imageTarget.blockId)) setImageTarget(null);
        }}
      />

      {videoBlock && (
        <TranscriptEditorDialog
          open={transcriptOpen}
          videoUrl={videoInfo.url}
          initial={videoInfo.transcript}
          saving={setTranscript.isPending}
          onClose={() => setTranscriptOpen(false)}
          onSave={async (cues) => {
            try {
              await setTranscript.mutateAsync({ lessonId: lesson.id, blockId: videoBlock.id, transcript: cues });
              toast.show('Trascrizione salvata', 'success');
              setTranscriptOpen(false);
            } catch {
              toast.show('Salvataggio trascrizione non riuscito', 'error');
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * Raccoglie i block che contengono almeno un MediaRef immagine (visita
 * ricorsiva, come findImageRef lato server). Ritorna { id, label, count } per
 * poter scegliere a quale block associare un'immagine stock.
 */
function collectImageBlocks(blocks: Block[]): Array<{ id: string; label: string; count: number }> {
  const typeLabels: Record<string, string> = {
    rich_text: 'Testo',
    image_hotspot: 'Immagine interattiva',
    timeline: 'Timeline',
    carousel_steps: 'Passi',
  };
  const out: Array<{ id: string; label: string; count: number }> = [];
  for (const block of blocks) {
    let count = 0;
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (node === null || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (obj.kind === 'image') count += 1;
      for (const v of Object.values(obj)) visit(v);
    };
    visit(block);
    if (count > 0) {
      out.push({ id: block.id, label: typeLabels[block.type] ?? block.type, count });
    }
  }
  return out;
}

/**
 * Info immagini di un singolo block: quante immagini contiene, quante sono
 * già riempite (storageKey) e il primo placeholderPrompt (per prefillare la
 * ricerca stock). Serve al pulsante per-block "aggiungi/sostituisci immagine".
 */
function blockImageInfo(block: Block): { count: number; filled: number; firstPrompt?: string } {
  let count = 0;
  let filled = 0;
  let firstPrompt: string | undefined;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (obj.kind === 'image') {
      count += 1;
      if (typeof obj.storageKey === 'string' && obj.storageKey) filled += 1;
      if (!firstPrompt && typeof obj.placeholderPrompt === 'string' && obj.placeholderPrompt.trim()) {
        firstPrompt = obj.placeholderPrompt.trim();
      }
    }
    for (const v of Object.values(obj)) visit(v);
  };
  visit(block);
  return { count, filled, firstPrompt };
}

/**
 * Una "scena cartoon" normalizzata dal punto di vista della UI: l'id scena (per
 * gli scenari è l'id del node; per i video_checkpoint è l'id del block) e la
 * media video associata. Rispecchia l'astrazione server collectCartoonScenes.
 */
type UiCartoonScene = { sceneId: string; media: Record<string, unknown> };

/**
 * Estrae le scene cartoon di un block, agnostico al tipo. Due sorgenti:
 *  - branching_scenario → una scena per node con media video (sceneId = node.id)
 *  - video_checkpoint   → una scena singola (sceneId = block.id, media=payload.video)
 * Difensivo sul payload (block non tipizzato qui).
 */
function cartoonScenesOf(block: Block): UiCartoonScene[] {
  if (block.type === 'branching_scenario') {
    const payload = (block.payload ?? {}) as { nodes?: Array<{ id?: unknown; media?: Record<string, unknown> }> };
    const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    const out: UiCartoonScene[] = [];
    for (const n of nodes) {
      const media = (n.media ?? {}) as Record<string, unknown>;
      if (String(media.kind) !== 'video') continue;
      const sceneId = typeof n.id === 'string' ? n.id : String(n.id ?? '');
      if (!sceneId) continue;
      out.push({ sceneId, media });
    }
    return out;
  }
  if (block.type === 'video_checkpoint') {
    const payload = (block.payload ?? {}) as { video?: Record<string, unknown> };
    const media = (payload.video ?? {}) as Record<string, unknown>;
    if (String(media.kind) !== 'video') return [];
    return [{ sceneId: block.id, media }];
  }
  return [];
}

/** True se il block ospita almeno una scena cartoon (scenario o video_checkpoint). */
function blockHasCartoonScenes(block: Block): boolean {
  return cartoonScenesOf(block).length > 0;
}

/**
 * Formato didattico effettivo di una lezione per la UI: la fonte di verità è
 * lesson.format; per i corsi storici (senza format) si deriva dai flag
 * videoFirst/pillola (pillola ha precedenza), con fallback a 'standard'.
 */
function lessonFormatOf(lesson: LessonView): 'pillola' | 'pillola_interattiva' | 'video_first' | 'standard' {
  if (
    lesson.format === 'pillola' ||
    lesson.format === 'pillola_interattiva' ||
    lesson.format === 'video_first' ||
    lesson.format === 'standard'
  ) {
    return lesson.format;
  }
  if (lesson.pillola) return 'pillola';
  if (lesson.videoFirst) return 'video_first';
  return 'standard';
}

/**
 * True se il block ha almeno una scena con video SEGNAPOSTO (media video senza
 * storageKey) ancora da generare: abilita il bottone "Genera cartoon".
 */
function scenarioHasPendingCartoon(block: Block): boolean {
  return cartoonScenesOf(block).some((s) => !s.media.storageKey);
}

/**
 * Conta lo stato dei cartoon delle scene di un block: quante scene video in
 * totale, quante pronte (storageKey) e quante in elaborazione (videoGenStatus=
 * 'processing'). Alimenta l'indicatore di avanzamento e l'auto-refresh.
 */
function scenarioCartoonProgress(block: Block): { total: number; ready: number; processing: number } {
  let total = 0;
  let ready = 0;
  let processing = 0;
  for (const s of cartoonScenesOf(block)) {
    total += 1;
    if (s.media.storageKey) ready += 1;
    else if (s.media.videoGenStatus === 'processing') processing += 1;
  }
  return { total, ready, processing };
}

/**
 * Id della PRIMA scena con cartoon segnaposto ancora da generare (o null).
 * Serve al bottone "prova una scena": genera un solo cartoon per testare il
 * provider video a costo minimo, invece di produrre tutte le scene insieme.
 */
function firstPendingCartoonNodeId(block: Block): string | null {
  for (const s of cartoonScenesOf(block)) {
    if (!s.media.storageKey) return s.sceneId;
  }
  return null;
}

const BLOCK_META: Record<string, { label: string; icon: string }> = {
  rich_text: { label: 'Testo', icon: '¶' },
  image_hotspot: { label: 'Immagine interattiva', icon: '◉' },
  accordion_tabs: { label: 'Accordion / Tab', icon: '▤' },
  flashcard: { label: 'Flashcard', icon: '⬌' },
  timeline: { label: 'Timeline', icon: '⏱' },
  carousel_steps: { label: 'Passi', icon: '≫' },
  click_reveal: { label: 'Click & reveal', icon: '✶' },
  branching_scenario: { label: 'Scenario', icon: '⌥' },
  video_checkpoint: { label: 'Video', icon: '▷' },
  dragdrop_match: { label: 'Abbinamento', icon: '⇄' },
  dragdrop_order: { label: 'Ordinamento', icon: '↕' },
  sorting_categories: { label: 'Classificazione', icon: '⊞' },
};

/** Breve estratto descrittivo del contenuto di un block (per la riga compatta). */
function blockSummary(block: Block): string {
  const p = (block.payload ?? {}) as Record<string, unknown>;
  const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
  switch (block.type) {
    case 'rich_text': {
      const html = ((p.content as { html?: string })?.html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return html ? (html.length > 70 ? html.slice(0, 70) + '…' : html) : 'Testo vuoto';
    }
    case 'image_hotspot': {
      const n = count(p.hotspots);
      const hasImg = Boolean((p.image as { storageKey?: string })?.storageKey);
      return `${n} ${n === 1 ? 'punto' : 'punti'}${hasImg ? ' · sfondo impostato' : ' · immagine mancante'}`;
    }
    case 'flashcard':
      return `${count(p.cards)} carte`;
    case 'timeline':
      return `${count(p.events)} tappe`;
    case 'carousel_steps':
      return `${count(p.steps)} passi`;
    case 'accordion_tabs':
      return `${count(p.panels)} pannelli`;
    case 'click_reveal':
      return `${count(p.items)} elementi`;
    case 'branching_scenario':
      return `${count(p.nodes)} nodi`;
    case 'dragdrop_match':
      return `${count(p.pairs)} abbinamenti`;
    case 'dragdrop_order':
      return `${count(p.items)} elementi da ordinare`;
    case 'sorting_categories':
      return `${count(p.items)} elementi · ${count(p.categories)} categorie`;
    case 'video_checkpoint':
      return (p.video as { storageKey?: string })?.storageKey ? 'Video impostato' : 'Video da caricare';
    default:
      return '';
  }
}

/** Dialog di selezione di un video dalla libreria del tenant. */
/**
 * Dialog per generare un video con avatar parlante (HeyGen) per un concetto.
 * L'autore sceglie avatar e voce (caricati dal server; nel mock sono demo) e
 * opzionalmente fornisce un copione; altrimenti il server lo sintetizza dal
 * testo del concetto. Mostra l'avviso sui limiti del piano Free.
 */
function GenerateAvatarVideoDialog({
  open,
  courseId,
  saving,
  onClose,
  onGenerate,
}: {
  open: boolean;
  courseId: string;
  saving: boolean;
  onClose: () => void;
  onGenerate: (input: { avatarId?: string; voiceId?: string; script?: string }) => void;
}) {
  // Sorgente avatar: 'mine' (account) o 'stock' (catalogo HeyGen). Ricerca
  // avatar e voci con debounce (interrogano il server, paginato).
  const [avatarSource, setAvatarSource] = React.useState<'mine' | 'stock'>('stock');
  const [avatarQuery, setAvatarQuery] = React.useState('');
  const avatarQ = useDebounced(avatarQuery, 350);
  const avatars = useVideoAvatars(courseId, open, { source: avatarSource, q: avatarQ || undefined });

  // Voci: filtrate per lingua del corso (default) o tutte; ricerca debounced.
  const [allLangs, setAllLangs] = React.useState(false);
  const [voiceQuery, setVoiceQuery] = React.useState('');
  const voiceQ = useDebounced(voiceQuery, 350);
  const voices = useVideoVoices(courseId, open, { language: allLangs ? 'all' : undefined, q: voiceQ || undefined });

  const [avatarId, setAvatarId] = React.useState('');
  const [voiceId, setVoiceId] = React.useState('');
  const [script, setScript] = React.useState('');
  // Anteprima audio voce: un solo <audio> riusato, con l'id in riproduzione.
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [playingVoice, setPlayingVoice] = React.useState<string | null>(null);

  // Appiattisce le pagine dell'infinite query.
  const avatarItems = React.useMemo(
    () => (avatars.data?.pages ?? []).flatMap((p) => p.items),
    [avatars.data],
  );
  const voiceItems = React.useMemo(
    () => (voices.data?.pages ?? []).flatMap((p) => p.items),
    [voices.data],
  );

  // NB: il parent passa una `key` legata al block target, quindi questo dialog
  // viene RIMONTATO da zero a ogni apertura: lo stato (avatar/voce/copione)
  // riparte sempre pulito, senza ricordare la scelta precedente.

  // Default avatar = primo disponibile; se cambia sorgente/ricerca e l'avatar
  // selezionato non è più in lista, riparte sul primo.
  React.useEffect(() => {
    if (avatarItems.length === 0) return;
    if (!avatarId || !avatarItems.some((a) => a.id === avatarId)) {
      setAvatarId(avatarItems[0]!.id);
    }
  }, [avatarItems, avatarId]);

  // Ferma l'audio alla chiusura del dialog.
  React.useEffect(() => {
    if (!open && audioRef.current) {
      audioRef.current.pause();
      setPlayingVoice(null);
    }
  }, [open]);

  function playVoice(v: { id: string; previewUrl?: string }) {
    if (!v.previewUrl) return;
    const el = audioRef.current ?? new Audio();
    audioRef.current = el;
    if (playingVoice === v.id) {
      el.pause();
      setPlayingVoice(null);
      return;
    }
    el.src = v.previewUrl;
    el.onended = () => setPlayingVoice(null);
    void el
      .play()
      .then(() => setPlayingVoice(v.id))
      .catch(() => setPlayingVoice(null));
  }

  const notConfigured =
    (avatars.isError && /501|non configurat/i.test(String(avatars.error))) ||
    (voices.isError && /501|non configurat/i.test(String(voices.error)));
  const avatarsLoading = avatars.isLoading || (avatars.isFetching && !avatars.isFetchingNextPage);
  const voicesLoading = voices.isLoading || (voices.isFetching && !voices.isFetchingNextPage);

  return (
    <Dialog open={open} onClose={onClose} title="Genera video con avatar AI" size="lg">
      {notConfigured ? (
        <p className="text-sm text-muted-foreground">
          La generazione video non è configurata sul server. Imposta
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">PROVIDER_VIDEO=heygen</code>
          e la <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">HEYGEN_API_KEY</code>.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md border border-amber-300/60 bg-amber-50 p-2.5 text-xs text-amber-900">
            Il piano HeyGen consuma crediti a consumo (per minuto di video) e il video sostituisce
            il concetto testuale, incluso nel pacchetto SCORM.
            <span className="mt-1 block text-amber-800">
              {avatarSource === 'mine'
                ? 'I tuoi avatar (photo) costano meno: Avatar III ≈ $0,99/min, Avatar IV ≈ $2,31/min.'
                : 'Gli avatar HeyGen (stock) costano di più: Avatar III ≈ $0,99/min, Avatar IV ≈ $4,83/min. Usa un tuo avatar per risparmiare.'}
            </span>
          </div>

          {/* --- Avatar: sorgente (miei/HeyGen) + ricerca + griglia paginata --- */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">Avatar</span>
              <div className="flex items-center gap-2">
                {/* Toggle sorgente */}
                <div className="inline-flex rounded-md border p-0.5 text-xs">
                  {(['mine', 'stock'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setAvatarSource(s)}
                      className={cn(
                        'rounded px-2 py-1 font-semibold transition-colors',
                        avatarSource === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                      )}
                      disabled={saving}
                    >
                      {s === 'mine' ? 'I miei' : 'HeyGen'}
                    </button>
                  ))}
                </div>
                <Input
                  value={avatarQuery}
                  onChange={(e) => setAvatarQuery(e.target.value)}
                  placeholder="Cerca avatar…"
                  className="h-8 max-w-[180px]"
                  disabled={saving}
                />
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto rounded-lg border p-2">
              {avatarsLoading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Spinner /> Carico gli avatar…
                </div>
              ) : avatarItems.length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">
                  {avatarSource === 'mine'
                    ? 'Nessun avatar personale. Creane uno su HeyGen o usa quelli HeyGen.'
                    : 'Nessun avatar trovato.'}
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {avatarItems.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        disabled={saving}
                        onClick={() => setAvatarId(a.id)}
                        className={cn(
                          'group flex flex-col overflow-hidden rounded-lg border text-left transition-colors',
                          a.id === avatarId ? 'border-primary ring-2 ring-primary/40' : 'hover:border-primary/50',
                        )}
                        title={a.name}
                      >
                        <div className="relative aspect-square w-full bg-muted">
                          {a.previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- URL esterno HeyGen, anteprima
                            <img src={a.previewUrl} alt={a.name} className="size-full object-cover" loading="lazy" />
                          ) : (
                            <div className="grid size-full place-items-center text-muted-foreground">
                              <UserRound className="size-6" />
                            </div>
                          )}
                          {a.id === avatarId && (
                            <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                              ✓
                            </span>
                          )}
                        </div>
                        <span className="truncate px-1.5 py-1 text-[11px] font-medium">{a.name}</span>
                      </button>
                    ))}
                  </div>
                  {avatars.hasNextPage && (
                    <div className="mt-2 flex justify-center">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void avatars.fetchNextPage()}
                        disabled={avatars.isFetchingNextPage}
                      >
                        {avatars.isFetchingNextPage ? <AiWorkingInline label="Carico…" /> : 'Carica altri avatar'}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* --- Voce: ricerca + elenco paginato con anteprima audio --- */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">
                Voce{' '}
                <span className="font-normal text-muted-foreground">
                  {allLangs ? '(tutte le lingue)' : '(lingua del corso)'}
                </span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="text-xs font-semibold text-primary hover:underline"
                  onClick={() => {
                    setAllLangs((v) => !v);
                    setVoiceId('');
                  }}
                  disabled={saving}
                >
                  {allLangs ? 'Solo lingua corso' : 'Tutte le lingue'}
                </button>
                <Input
                  value={voiceQuery}
                  onChange={(e) => setVoiceQuery(e.target.value)}
                  placeholder="Cerca voce…"
                  className="h-8 max-w-[160px]"
                  disabled={saving}
                />
              </div>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-lg border p-1.5">
              <label
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                  voiceId === '' ? 'bg-primary/10' : 'hover:bg-accent/40',
                )}
              >
                <input
                  type="radio"
                  name="vf-voice"
                  checked={voiceId === ''}
                  onChange={() => setVoiceId('')}
                  disabled={saving}
                />
                <span>Voce predefinita dell&apos;avatar</span>
              </label>
              {voicesLoading ? (
                <div className="flex items-center justify-center gap-2 py-5 text-sm text-muted-foreground">
                  <Spinner /> Carico le voci…
                </div>
              ) : (
                <>
                  {voiceItems.map((v) => (
                    <div
                      key={v.id}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                        v.id === voiceId ? 'bg-primary/10' : 'hover:bg-accent/40',
                      )}
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                        <input
                          type="radio"
                          name="vf-voice"
                          checked={v.id === voiceId}
                          onChange={() => setVoiceId(v.id)}
                          disabled={saving}
                        />
                        <span className="min-w-0 truncate">
                          {v.name}
                          {v.language ? <span className="text-muted-foreground"> · {v.language}</span> : ''}
                          {v.gender ? <span className="text-muted-foreground"> · {v.gender}</span> : ''}
                        </span>
                      </label>
                      {v.previewUrl && (
                        <button
                          type="button"
                          onClick={() => playVoice(v)}
                          className="shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold text-primary hover:bg-primary/10"
                          title="Ascolta anteprima"
                        >
                          {playingVoice === v.id ? '◼ Stop' : '▶ Ascolta'}
                        </button>
                      )}
                    </div>
                  ))}
                  {voiceItems.length === 0 && (
                    <p className="p-2 text-xs text-muted-foreground">
                      Nessuna voce trovata. Prova «Tutte le lingue» o cambia la ricerca.
                    </p>
                  )}
                  {voices.hasNextPage && (
                    <div className="mt-1 flex justify-center">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void voices.fetchNextPage()}
                        disabled={voices.isFetchingNextPage}
                      >
                        {voices.isFetchingNextPage ? <AiWorkingInline label="Carico…" /> : 'Carica altre voci'}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* --- Riepilogo tipo avatar scelto + prezzo/min (engine deciso dal
                server). Niente scelta engine: mostriamo cosa stai usando. --- */}
          {(() => {
            const selectedAvatar = avatarItems.find((a) => a.id === avatarId);
            // Tipo ai fini di prezzo/etichetta: dedotto da sorgente + groupType.
            const typeLabel = heygenAvatarTypeLabel({
              source: avatarSource,
              groupType: selectedAvatar?.groupType,
            });
            const billingType = avatarSource === 'mine' ? 'photo' : 'studio';
            const pricePerMin = heygenCustomerPricePerMinUsd(DEFAULT_HEYGEN_ENGINE, billingType);
            return (
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    Tipo avatar: <span className="text-primary">{typeLabel}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Il motore di rendering è ottimizzato automaticamente per questo tipo di avatar.
                  </p>
                </div>
                <span className="shrink-0 rounded bg-primary/10 px-2 py-1 text-sm font-semibold text-primary">
                  ${pricePerMin.toFixed(2)}/min
                </span>
              </div>
            );
          })()}

          <label className="block space-y-1">
            <span className="text-sm font-medium">
              Copione <span className="font-normal text-muted-foreground">(opzionale)</span>
            </span>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={3}
              maxLength={1200}
              disabled={saving}
              placeholder="Lascia vuoto per generare automaticamente il copione dal testo del concetto. Max ~1 minuto di parlato."
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-50"
            />
          </label>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Annulla
            </Button>
            <Button
              onClick={() =>
                onGenerate({
                  avatarId: avatarId || undefined,
                  voiceId: voiceId || undefined,
                  script: script.trim() || undefined,
                })
              }
              disabled={saving || avatarsLoading || !avatarId}
            >
              <UserRound className="size-4" />
              {saving ? <AiWorkingInline label="Avvio…" /> : 'Genera video'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Spinner animato leggero (cerchio rotante) per gli stati di caricamento. */
function Spinner() {
  return (
    <span
      className="inline-block size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary"
      aria-hidden
    />
  );
}

/** Ritarda un valore (debounce) per non interrogare il server a ogni tasto. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function VideoLibraryDialog({
  open,
  saving,
  onClose,
  onSelect,
}: {
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSelect: (videoAssetId: string) => void;
}) {
  const videos = useVideos();
  const sourceLabel: Record<string, string> = { upload: 'Caricato', youtube: 'YouTube', vimeo: 'Vimeo', twitch: 'Twitch' };
  return (
    <Dialog open={open} onClose={onClose} title="Scegli un video dalla libreria">
      {videos.isLoading ? (
        <p className="text-sm text-muted-foreground">Carico la libreria…</p>
      ) : (videos.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">
          La libreria è vuota. Aggiungi video dalla sezione «Video» del menu.
        </p>
      ) : (
        <div className="grid max-h-[420px] gap-2 overflow-y-auto sm:grid-cols-2">
          {videos.data!.map((v) => (
            <button
              key={v.id}
              type="button"
              disabled={saving}
              onClick={() => onSelect(v.id)}
              className="group flex flex-col overflow-hidden rounded-lg border text-left transition-colors hover:border-primary/50 disabled:opacity-60"
            >
              <div className="relative aspect-video w-full bg-black">
                {v.source === 'upload' && v.url ? (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video src={v.url} preload="metadata" className="size-full object-contain" />
                ) : (
                  <div className="flex size-full items-center justify-center bg-gradient-to-br from-primary/10 to-accent/40">
                    <Video className="size-8 text-primary/40" />
                  </div>
                )}
                <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
                  {sourceLabel[v.source] ?? v.source}
                </span>
              </div>
              <div className="p-2">
                <p className="line-clamp-1 text-sm font-medium">{v.title}</p>
                {v.channel && <p className="text-xs text-muted-foreground">{v.channel}</p>}
              </div>
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}

/** Controlli di stato editoriale: badge corrente + azioni di transizione. */
function StatusControls({
  status,
  onChange,
}: {
  status: EditorialStatus;
  onChange: (s: EditorialStatus) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <EditorialStatusBadge status={status} />
      {status !== 'APPROVED' && (
        <Button size="sm" variant="outline" onClick={() => onChange('APPROVED')}>
          Approva
        </Button>
      )}
      {status === 'APPROVED' && (
        <Button size="sm" variant="ghost" onClick={() => onChange('DRAFT')}>
          Riapri
        </Button>
      )}
    </div>
  );
}
