'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Sparkles, Wand2, Trash2, Pencil, Image as ImageIcon, Volume2, Video, Captions, Search, Check } from 'lucide-react';
import type { Block } from '@scorm/contracts';
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
  useAttachStockImage,
  useVideos,
  useActiveJobs,
  useEditLessonBlocks,
  useSetStatus,
  useSetStatusAll,
  useSetLessonVideoFirst,
  useJobStatus,
  useAssessments,
  useDeleteAssessment,
  useGenerateAssessment,
  qk,
} from '@/lib/api/hooks';
import { AiWorking, AiWorkingInline } from '@/components/courses/ai-working';
import type { EditorialStatus } from '@/lib/api/types';

/**
 * mode:
 *  - 'structure': genera la struttura (outline + materializzazione automatica) e
 *    permette di editare moduli/lezioni. Non mostra la generazione contenuti.
 *  - 'content': genera i contenuti (singoli o tutti) delle lezioni esistenti.
 */
export function CourseBuilder({ courseId, mode = 'content' }: { courseId: string; mode?: 'structure' | 'content' }) {
  const modules = useModules(courseId);
  const addModule = useAddModule(courseId);
  const genOutline = useGenerateOutline(courseId);
  const qc = useQueryClient();
  const toast = useToast();
  const [newModuleTitle, setNewModuleTitle] = React.useState('');
  const [outlineJobId, setOutlineJobId] = React.useState<string | null>(null);

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
            <div className="space-y-4">
              {modules.data?.map((m) => (
                <ModuleCard key={m.id} courseId={courseId} module={m} editableLessons />
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
  return <ContentBuilder courseId={courseId} />;
}

/**
 * Step contenuti: genera i contenuti di tutte le lezioni in un colpo (job a
 * cascata) con avanzamento, oppure di una singola lezione come override.
 */
function ContentBuilder({ courseId }: { courseId: string }) {
  const modules = useModules(courseId);
  const genAll = useGenerateAllContent(courseId);
  const approveAll = useSetStatusAll(courseId);
  const activeJobs = useActiveJobs(courseId);
  const qc = useQueryClient();
  const toast = useToast();

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

      <div className="space-y-4">
        {modules.data.map((m) => (
          <ModuleCard key={m.id} courseId={courseId} module={m} batchActive={batchActive} />
        ))}
      </div>

      <AssessmentManager courseId={courseId} modules={modules.data} />
    </div>
  );
}

/**
 * Gestione dei test del corso: elenca gli assessment (collegandoli al modulo),
 * permette di eliminarli e di (ri)generare un test intermedio per modulo o il
 * test finale. Utile per correggere corsi con test orfani (moduleId mancante)
 * o per aggiungerne di nuovi senza rigenerare tutti i contenuti.
 */
function AssessmentManager({ courseId, modules }: { courseId: string; modules: ModuleView[] }) {
  const assessments = useAssessments(courseId);
  const del = useDeleteAssessment(courseId);
  const gen = useGenerateAssessment(courseId);
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

  const generating = Boolean(jobId);
  const list = assessments.data ?? [];
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

  async function handleGenerate(scope: 'intermediate' | 'final', moduleId?: string) {
    try {
      const { jobId: id } = await gen.mutateAsync({ scope, moduleId });
      setJobId(id);
      toast.show('Generazione test avviata…', 'success');
    } catch {
      toast.show('Avvio generazione test non riuscito', 'error');
    }
  }

  async function handleDelete(assessmentId: string) {
    try {
      await del.mutateAsync(assessmentId);
      toast.show('Test eliminato', 'success');
    } catch {
      toast.show('Eliminazione non riuscita', 'error');
    }
  }

  return (
    <Card>
      <CardHeader className="space-y-0">
        <CardTitle className="text-base">Test del corso</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          I test intermedi bloccano l&apos;avanzamento finché non sono superati; il test finale
          determina l&apos;esito del corso. Un test intermedio deve essere collegato al suo modulo.
        </p>

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
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
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
            {modules.map((m) => (
              <Button
                key={m.id}
                size="sm"
                variant="outline"
                disabled={generating || modulesWithIntermediate.has(m.id)}
                onClick={() => handleGenerate('intermediate', m.id)}
                title={modulesWithIntermediate.has(m.id) ? 'Questo modulo ha già un test intermedio' : `Genera il test intermedio di "${m.title}"`}
              >
                <Wand2 className="size-4" />
                {`Intermedio: ${m.title.length > 24 ? m.title.slice(0, 24) + '…' : m.title}`}
              </Button>
            ))}
            <Button
              size="sm"
              disabled={generating || hasFinal}
              onClick={() => handleGenerate('final')}
              title={hasFinal ? 'Esiste già un test finale' : 'Genera il test finale del corso'}
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
  editableLessons = false,
  batchActive = false,
}: {
  courseId: string;
  module: ModuleView;
  /** Modalità struttura: consenti aggiunta/eliminazione lezioni, niente contenuti. */
  editableLessons?: boolean;
  /** Modalità contenuti: true mentre il job batch "genera tutti" è in corso. */
  batchActive?: boolean;
}) {
  const addLesson = useAddLesson(courseId);
  const deleteModule = useDeleteModule(courseId);
  const setStatus = useSetStatus(courseId);
  const toast = useToast();
  const [newLesson, setNewLesson] = React.useState('');
  const [confirmOpen, setConfirmOpen] = React.useState(false);

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

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{module.title}</CardTitle>
        <div className="flex items-center gap-2">
          <StatusControls
            status={module.status}
            onChange={(s) => setStatus.mutate({ entity: 'module', entityId: module.id, status: s })}
          />
          <Button
            size="icon"
            variant="ghost"
            aria-label="Elimina modulo"
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {module.lessons.map((l) => (
          <LessonCard
            key={l.id}
            courseId={courseId}
            moduleId={module.id}
            lesson={l}
            editableLessons={editableLessons}
            batchActive={batchActive}
          />
        ))}
        {editableLessons && (
          <form onSubmit={handleAddLesson} className="flex gap-2">
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
  editableLessons = false,
  batchActive = false,
}: {
  courseId: string;
  moduleId: string;
  lesson: LessonView;
  editableLessons?: boolean;
  /** True mentre il job batch "genera tutti" è in corso sul corso. */
  batchActive?: boolean;
}) {
  const qc = useQueryClient();
  const genContent = useGenerateLessonContent(courseId);
  const genImages = useGenerateLessonImages(courseId);
  const genNarration = useGenerateLessonNarration(courseId);
  const uploadVideo = useUploadLessonVideo(courseId);
  const attachVideo = useAttachVideoFromLibrary(courseId);
  const attachStock = useAttachStockImage(courseId);
  const setTranscript = useSetVideoTranscript(courseId);
  const deleteLesson = useDeleteLesson(courseId);
  const editBlocks = useEditLessonBlocks(courseId);
  const setStatus = useSetStatus(courseId);
  const setVideoFirst = useSetLessonVideoFirst(courseId);
  const toast = useToast();
  const [tone, setTone] = React.useState('');
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Block | null>(null);
  const videoInputRef = React.useRef<HTMLInputElement>(null);
  const [videoTargetBlock, setVideoTargetBlock] = React.useState<string | null>(null);
  // Dialog di selezione video dalla libreria (per il block video_checkpoint).
  const [libraryTargetBlock, setLibraryTargetBlock] = React.useState<string | null>(null);
  // Dialog di ricerca immagini stock (royalty-free).
  const [stockOpen, setStockOpen] = React.useState(false);
  // Dialog editor della trascrizione video.
  const [transcriptOpen, setTranscriptOpen] = React.useState(false);
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

  async function handleGenerateNarration() {
    try {
      await genNarration.mutateAsync(lesson.id);
      toast.show('Narrazione generata', 'success');
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

  // Modalità struttura: solo titolo, stato ed eliminazione lezione.
  if (editableLessons) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-4 py-2">
        <span className="text-sm font-medium">{lesson.title}</span>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground" title="Lezione incentrata su un video (quiz ed elementi dinamici affiancati)">
            <input
              type="checkbox"
              className="size-4 accent-[hsl(var(--primary))]"
              checked={lesson.videoFirst === true}
              disabled={setVideoFirst.isPending}
              onChange={(e) =>
                setVideoFirst.mutate({ moduleId, lessonId: lesson.id, videoFirst: e.target.checked })
              }
            />
            <Video className="size-3.5" /> Video
          </label>
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

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{lesson.title}</span>
        <div className="flex items-center gap-2">
          <StatusControls
            status={lesson.status}
            onChange={(s) => setStatus.mutate({ entity: 'lesson', entityId: lesson.id, status: s })}
          />
          <Button size="icon" variant="ghost" aria-label="Elimina lezione" onClick={() => setConfirmOpen(true)}>
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </div>

      {generating ? (
        <AiWorking label={`Sto generando i contenuti di «${lesson.title}»…`} />
      ) : lesson.blocks.length > 0 ? (
        <div className="space-y-2">
          {lesson.blocks.map((b) => (
            <div key={b.id} className="group relative">
              <BlockPreview
                block={b}
                onUploadVideo={b.type === 'video_checkpoint' ? pickVideo : undefined}
                onEditTranscript={b.type === 'video_checkpoint' ? () => setTranscriptOpen(true) : undefined}
              />
              <Button
                size="icon"
                variant="outline"
                aria-label="Modifica block"
                className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => setEditing(b)}
              >
                <Pencil className="size-4" />
              </Button>
            </div>
          ))}
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
            <Button size="sm" variant="outline" onClick={handleGenerateNarration} disabled={genNarration.isPending}>
              <Volume2 className="size-4" />
              {genNarration.isPending ? <AiWorkingInline label="Narrazione…" /> : 'Genera narrazione'}
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
                {videoInfo.hasVideo && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTranscriptOpen(true)}
                    disabled={setTranscript.isPending}
                  >
                    <Captions className="size-4" />
                    {setTranscript.isPending ? <AiWorkingInline label="Salvo…" /> : 'Trascrizione'}
                  </Button>
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

      <StockPhotoPicker
        open={stockOpen}
        courseId={courseId}
        targets={imageBlocks}
        saving={attachStock.isPending}
        onClose={() => setStockOpen(false)}
        onSelect={async (photo, blockId) => {
          if (!blockId) return;
          try {
            await attachStock.mutateAsync({
              lessonId: lesson.id,
              input: {
                blockId,
                photoId: photo.id,
                provider: photo.provider,
                alt: photo.alt || undefined,
              },
            });
            toast.show('Immagine stock collegata', 'success');
            setStockOpen(false);
          } catch (err) {
            toast.show(
              err instanceof Error && /501|non configurata/i.test(err.message)
                ? 'Libreria immagini stock non configurata sul server'
                : 'Collegamento immagine non riuscito',
              'error',
            );
          }
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

/** Dialog di selezione di un video dalla libreria del tenant. */
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
