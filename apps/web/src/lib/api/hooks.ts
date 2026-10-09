'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Block, Brief, PricingQuoteInput } from '@scorm/contracts';
import { getApiClient } from './client';
import type { BrandView, EditorialStatus, KnowledgeScope, ScormProfile, UpdateAppBranding, CreateExternalVideo, UpdateVideoAsset, TranscriptCue, AppUserRole, AttachStockImageInput, AttachStockCoverInput } from './types';

const api = getApiClient();

/** Chiavi di cache centralizzate per invalidazioni coerenti. */
export const qk = {
  courses: ['courses'] as const,
  course: (id: string) => ['courses', id] as const,
  modules: (id: string) => ['courses', id, 'modules'] as const,
  jobs: (id: string) => ['courses', id, 'jobs'] as const,
  job: (id: string, jobId: string) => ['courses', id, 'jobs', jobId] as const,
  knowledge: (scope?: string, courseId?: string) => ['knowledge', scope, courseId] as const,
  brands: ['brands'] as const,
  brand: (id: string) => ['brands', id] as const,
  usage: ['usage'] as const,
  audit: ['audit'] as const,
  cost: (id: string) => ['courses', id, 'cost'] as const,
  folders: ['folders'] as const,
  branding: ['branding'] as const,
  videos: ['videos'] as const,
  videoChannels: ['videos', 'channels'] as const,
  users: ['users'] as const,
  stockImages: (courseId: string, q: string) => ['courses', courseId, 'stock-images', q] as const,
};

// --- Corsi ------------------------------------------------------------------

export const useCourses = (filter?: { folderId?: string | 'root'; q?: string }) =>
  useQuery({
    queryKey: [...qk.courses, filter?.folderId ?? 'all', filter?.q ?? ''],
    queryFn: () => api.listCourses(filter),
  });
export const useCourse = (id: string) =>
  useQuery({ queryKey: qk.course(id), queryFn: () => api.getCourse(id), enabled: !!id });

export function useCreateCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; description?: string; language: string }) => api.createCourse(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.courses }),
  });
}

export function useDeleteCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteCourse(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.courses }),
  });
}

// --- Cartelle ---------------------------------------------------------------

export const useFolders = () => useQuery({ queryKey: qk.folders, queryFn: () => api.listFolders() });

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; parentId?: string | null }) => api.createFolder(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.folders }),
  });
}

export function useUpdateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; name?: string; parentId?: string | null }) =>
      api.updateFolder(vars.id, { name: vars.name, parentId: vars.parentId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.folders }),
  });
}

export function useDeleteFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteFolder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.folders });
      qc.invalidateQueries({ queryKey: qk.courses });
    },
  });
}

export function useMoveCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { courseId: string; folderId: string | null }) =>
      api.moveCourse(vars.courseId, vars.folderId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.courses });
      qc.invalidateQueries({ queryKey: qk.folders });
    },
  });
}

export function useSaveBrief(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (brief: Brief) => api.saveBrief(courseId, brief),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.course(courseId) });
      qc.invalidateQueries({ queryKey: qk.courses });
    },
  });
}

export function useUpdateCourseSettings(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: { interactionStyle?: 'sober' | 'lively'; navPosition?: 'side' | 'top'; primaryBrandId?: string; instructor?: { name?: string; role?: string; avatarKey?: string } }) =>
      api.updateCourseSettings(courseId, settings),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.course(courseId) }),
  });
}

export function useUploadInstructorAvatar(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.uploadInstructorAvatar(courseId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.course(courseId) }),
  });
}

export function useSetCourseShareable(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shareable: boolean) => api.setCourseShareable(courseId, shareable),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.course(courseId) }),
  });
}

// --- Moduli / lezioni -------------------------------------------------------

export const useModules = (courseId: string) =>
  useQuery({ queryKey: qk.modules(courseId), queryFn: () => api.listModules(courseId), enabled: !!courseId });

export const useAssessments = (courseId: string) =>
  useQuery({
    queryKey: ['courses', courseId, 'assessments'],
    queryFn: () => api.listAssessments(courseId),
    enabled: !!courseId,
  });

/** Elimina un assessment del corso. */
export function useDeleteAssessment(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assessmentId: string) => api.deleteAssessment(courseId, assessmentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['courses', courseId, 'assessments'] }),
  });
}

/** Ripara i test intermedi orfani (collega al modulo, rimuove i duplicati). */
export function useRepairAssessments(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.repairAssessments(courseId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['courses', courseId, 'assessments'] }),
  });
}

/** Avvia la generazione (asincrona) di un assessment (scope + eventuale modulo). */
export function useGenerateAssessment(courseId: string) {
  return useMutation({
    mutationFn: (input: { scope: 'intermediate' | 'final'; moduleId?: string; focus?: string }) =>
      api.generateAssessment(courseId, input),
  });
}

export function useAddModule(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; summary?: string }) => api.addModule(courseId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.modules(courseId) }),
  });
}

export function useAddLesson(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { moduleId: string; title: string }) => api.addLesson(courseId, vars.moduleId, { title: vars.title }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.modules(courseId) }),
  });
}

export function useDeleteModule(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (moduleId: string) => api.deleteModule(courseId, moduleId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.modules(courseId) }),
  });
}

export function useDeleteLesson(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { moduleId: string; lessonId: string }) =>
      api.deleteLesson(courseId, vars.moduleId, vars.lessonId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.modules(courseId) }),
  });
}

/** Materializza l'outline generato dall'AI in moduli/lezioni (idempotente). */
export function useApplyOutline(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.applyOutline(courseId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.modules(courseId) });
      qc.invalidateQueries({ queryKey: qk.course(courseId) });
    },
  });
}

// --- Generazione ------------------------------------------------------------

// La generazione è asincrona: le mutation ritornano { jobId }. Il polling dello
// stato avviene con useJobStatus; al COMPLETED si invalidano le query dei dati.
export function useGenerateOutline(courseId: string) {
  return useMutation({
    mutationFn: () => api.generateOutline(courseId),
  });
}

export function useGenerateLessonContent(courseId: string) {
  return useMutation({
    mutationFn: (vars: { lessonId: string; toneInstruction?: string }) =>
      api.generateLessonContent(courseId, vars.lessonId, vars.toneInstruction),
  });
}

/** Avvia la generazione di TUTTI i contenuti (job batch server-side). */
export function useGenerateAllContent(courseId: string) {
  return useMutation({
    mutationFn: () => api.generateAllContent(courseId),
  });
}

/**
 * Corsi del tenant con generazione attiva (badge "in generazione"). Polling
 * continuo leggero: finché c'è almeno un corso attivo rinfresca ogni 2s.
 */
export function useActiveCourseJobs(enabled = true) {
  return useQuery({
    queryKey: ['jobs', 'active-all'],
    queryFn: () => api.listActiveCourseIds(),
    enabled,
    refetchInterval: () => 3000,
  });
}

/** Carica un video dell'utente nel segnaposto video di un block. */
export function useUploadLessonVideo(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { lessonId: string; blockId: string; file: File }) =>
      api.uploadLessonVideo(courseId, vars.lessonId, vars.blockId, vars.file),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.modules(courseId) }),
  });
}

/**
 * Polling dello stato di un job di generazione (modello di useKnowledge).
 * Interroga finché il job non è COMPLETED/FAILED. Quando termina, il chiamante
 * può invalidare le query dei dati (moduli/corso) tramite onSettled esterno.
 */
export function useJobStatus(courseId: string, jobId: string | null) {
  return useQuery({
    queryKey: qk.job(courseId, jobId ?? 'none'),
    queryFn: () => api.getJob(courseId, jobId as string),
    enabled: !!courseId && !!jobId,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'QUEUED' || s === 'RUNNING' ? 1200 : false;
    },
  });
}

/** Job attivi del corso (QUEUED/RUNNING): per riflettere "AI al lavoro". */
export function useActiveJobs(courseId: string, enabled = true) {
  return useQuery({
    queryKey: qk.jobs(courseId),
    queryFn: () => api.listActiveJobs(courseId),
    enabled: !!courseId && enabled,
    refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? 1200 : false),
  });
}

export function useGenerateLessonImages(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lessonId: string) => api.generateLessonImages(courseId, lessonId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.modules(courseId) }),
  });
}

export function useGenerateLessonNarration(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lessonId: string) => api.generateLessonNarration(courseId, lessonId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.modules(courseId) }),
  });
}

export function useGenerateCover(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.generateCover(courseId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.course(courseId) }),
  });
}

export function useGenerateModuleCover(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (moduleId: string) => api.generateModuleCover(courseId, moduleId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.modules(courseId) }),
  });
}

// --- Editor HITL ------------------------------------------------------------

export function useEditLessonBlocks(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { lessonId: string; blocks: Block[]; expectedUpdatedAt: string }) =>
      api.editLessonBlocks(courseId, vars.lessonId, vars.blocks, vars.expectedUpdatedAt),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.modules(courseId) }),
  });
}

export function useSetStatus(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { entity: 'course' | 'module' | 'lesson' | 'assessment'; entityId: string; status: EditorialStatus }) =>
      api.setStatus(courseId, vars.entity, vars.entityId, vars.status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.modules(courseId) });
      qc.invalidateQueries({ queryKey: qk.course(courseId) });
    },
  });
}

/** Applica uno stato (default APPROVED) a tutto il corso in un colpo solo. */
export function useSetStatusAll(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: EditorialStatus = 'APPROVED') => api.setStatusAll(courseId, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.modules(courseId) });
      qc.invalidateQueries({ queryKey: qk.course(courseId) });
    },
  });
}

/** Marca/smarca una lezione come video-first (step struttura). */
export function useSetLessonVideoFirst(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { moduleId: string; lessonId: string; videoFirst: boolean }) =>
      api.setLessonVideoFirst(courseId, vars.moduleId, vars.lessonId, vars.videoFirst),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.modules(courseId) }),
  });
}

/**
 * Chunk + embeddings neurali del corso per la ricerca semantica in anteprima.
 * `enabled` permette il caricamento LAZY (solo quando serve), perché il calcolo
 * degli embeddings lato server è lento: così il widget monta subito (lessicale)
 * e la ricerca neurale si attiva quando gli embeddings sono pronti.
 */
export function useRagEmbeddings(courseId: string, enabled = true) {
  return useQuery({
    queryKey: ['courses', courseId, 'rag-embeddings'],
    queryFn: () => api.getRagEmbeddings(courseId),
    enabled: !!courseId && enabled,
    staleTime: 30 * 60_000,
  });
}

/** Chunk della knowledge del corso per il widget RAG in anteprima. */
export function useRagChunks(courseId: string) {
  return useQuery({
    queryKey: ['courses', courseId, 'rag-chunks'],
    queryFn: () => api.getRagChunks(courseId),
    enabled: !!courseId,
    staleTime: 5 * 60_000,
  });
}

// --- Knowledge --------------------------------------------------------------

export const useKnowledge = (scope?: KnowledgeScope, courseId?: string) =>
  useQuery({
    queryKey: qk.knowledge(scope, courseId),
    queryFn: () => api.listKnowledge(scope, courseId),
    // Polling finché ci sono documenti in elaborazione, per riflettere il
    // passaggio PENDING/PROCESSING -> READY senza refresh manuale.
    refetchInterval: (query) => {
      const data = query.state.data;
      const pending = data?.some((d) => d.status === 'PENDING' || d.status === 'PROCESSING');
      return pending ? 1500 : false;
    },
  });

export function useUploadKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { file: File; scope: KnowledgeScope; courseId?: string }) =>
      api.uploadKnowledge(vars.file, vars.scope, vars.courseId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge'] }),
  });
}

export function useDeleteKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteKnowledge(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge'] }),
  });
}

// --- Brand ------------------------------------------------------------------

export const useBrands = () => useQuery({ queryKey: qk.brands, queryFn: () => api.listBrands() });
export const useBrand = (id: string) =>
  useQuery({ queryKey: qk.brand(id), queryFn: () => api.getBrand(id), enabled: !!id });

export function useSaveBrand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id?: string; def: Omit<BrandView, 'id' | 'tenantId'> }) =>
      vars.id ? api.updateBrand(vars.id, vars.def) : api.createBrand(vars.def),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.brands }),
  });
}

export function useDeleteBrand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteBrand(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.brands }),
  });
}

// --- Export / usage / audit -------------------------------------------------

export function useExportCourse(courseId: string) {
  return useMutation({
    mutationFn: (vars: { brandId: string; profile: ScormProfile; allowUnapproved?: boolean; includeSemanticSearch?: boolean }) =>
      api.exportCourse(courseId, vars.brandId, vars.profile, vars.allowUnapproved, vars.includeSemanticSearch),
  });
}

export const useUsage = () => useQuery({ queryKey: qk.usage, queryFn: () => api.getUsage() });
export const useAudit = () => useQuery({ queryKey: qk.audit, queryFn: () => api.listAudit() });

// --- Costi / pricing --------------------------------------------------------

/** Costo consuntivo del corso (somma degli UsageRecord misurati). */
export const useCourseCost = (courseId: string) =>
  useQuery({
    queryKey: qk.cost(courseId),
    queryFn: () => api.getCourseCost(courseId),
    enabled: !!courseId,
  });

/** Preventivo cliente del corso: ricalcolato al variare di markup/buffer/fee. */
export function useCourseQuote(courseId: string, input: PricingQuoteInput) {
  return useQuery({
    queryKey: [...qk.cost(courseId), 'quote', input.markupPct, input.bufferPct, input.flatFeeUsd],
    queryFn: () => api.getCourseQuote(courseId, input),
    enabled: !!courseId,
  });
}

// --- Branding white-label ---------------------------------------------------

/** Branding white-label della web app (nome, colore, logo, favicon). */
// --- Utenti (admin) ---------------------------------------------------------

export const useUsers = () =>
  useQuery({ queryKey: qk.users, queryFn: () => api.listUsers() });

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; displayName?: string; role: AppUserRole }) =>
      api.createUser(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.users }),
  });
}

export const useBranding = () =>
  useQuery({ queryKey: qk.branding, queryFn: () => api.getBranding(), staleTime: 5 * 60_000 });

export function useUpdateBranding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateAppBranding) => api.updateBranding(patch),
    onSuccess: (data) => qc.setQueryData(qk.branding, data),
  });
}

export function useUploadBrandingAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { kind: 'logo' | 'favicon'; file: File }) =>
      api.uploadBrandingAsset(vars.kind, vars.file),
    onSuccess: (data) => qc.setQueryData(qk.branding, data),
  });
}

// --- Libreria video per-tenant ----------------------------------------------

/** Lista della libreria video, filtrabile per sorgente/canale. */
export function useVideos(filter?: { source?: string; channel?: string }) {
  return useQuery({
    queryKey: [...qk.videos, filter?.source ?? 'all', filter?.channel ?? 'all'],
    queryFn: () => api.listVideos(filter),
    // Polling finché qualche video è in trascrizione (riflette READY senza refresh).
    refetchInterval: (query) => {
      const data = query.state.data;
      const processing = data?.some((v) => v.transcriptStatus === 'processing');
      return processing ? 4000 : false;
    },
  });
}

/** Canali distinti della libreria (per raggruppare). */
export function useVideoChannels() {
  return useQuery({ queryKey: qk.videoChannels, queryFn: () => api.listVideoChannels(), staleTime: 60_000 });
}

export function useCreateExternalVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExternalVideo) => api.createExternalVideo(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.videos });
      qc.invalidateQueries({ queryKey: qk.videoChannels });
    },
  });
}

export function useUploadVideoAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { file: File; title?: string; channel?: string }) =>
      api.uploadVideoAsset(vars.file, { title: vars.title, channel: vars.channel }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.videos });
      qc.invalidateQueries({ queryKey: qk.videoChannels });
    },
  });
}

export function useUpdateVideoAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: UpdateVideoAsset }) => api.updateVideoAsset(vars.id, vars.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.videos }),
  });
}

export function useDeleteVideoAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteVideoAsset(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.videos }),
  });
}

/** Collega un video della libreria a un block video_checkpoint di una lezione. */
export function useAttachVideoFromLibrary(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { lessonId: string; blockId: string; videoAssetId: string }) =>
      api.attachVideoFromLibrary(courseId, vars.lessonId, vars.blockId, vars.videoAssetId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.modules(courseId) }),
  });
}

/** Salva/corregge a mano la trascrizione di un block video. */
export function useSetVideoTranscript(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { lessonId: string; blockId: string; transcript: TranscriptCue[] }) =>
      api.setVideoTranscript(courseId, vars.lessonId, vars.blockId, vars.transcript),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.modules(courseId) }),
  });
}

// --- Immagini stock royalty-free -------------------------------------------

/** Cerca immagini stock on-demand: abilitato solo quando `q` non è vuota. */
export const useSearchStockImages = (courseId: string, q: string) =>
  useQuery({
    queryKey: qk.stockImages(courseId, q),
    queryFn: () => api.searchStockImages(courseId, q),
    enabled: !!courseId && q.trim().length > 0,
    staleTime: 5 * 60 * 1000,
  });

/** Scarica e collega un'immagine stock a un block immagine della lezione. */
export function useAttachStockImage(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { lessonId: string; input: AttachStockImageInput }) =>
      api.attachStockImage(courseId, vars.lessonId, vars.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.modules(courseId) }),
  });
}

/** Imposta un'immagine stock come copertina del corso. */
export function useAttachStockCover(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AttachStockCoverInput) => api.attachStockCover(courseId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.course(courseId) }),
  });
}

/** Imposta un'immagine stock come copertina di un modulo. */
export function useAttachStockModuleCover(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { moduleId: string; input: AttachStockCoverInput }) =>
      api.attachStockModuleCover(courseId, vars.moduleId, vars.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.modules(courseId) }),
  });
}
