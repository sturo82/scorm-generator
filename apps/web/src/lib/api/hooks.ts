'use client';
import * as React from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FolderKind, CreatePodcast, CreatePodcastEpisode, SuggestPodcastIdeas, PodcastFeedVisibility, PodcastScript, PodcastView, UpdatePodcast, UpdatePodcastEpisodes, StartSlidesAutopilot, Block, Brief, CourseEstimateInput, CourseEstimateOptions, CreditQuoteItem, PricingQuoteInput, FeedCategory } from '@scorm/contracts';
import { getApiClient } from './client';
import type { PronunciationEntry, SlideAvatarType, StartSlideClipsInput, BrandView, EditorialStatus, KnowledgeScope, ScormProfile, UpdateAppBranding, CreateExternalVideo, UpdateVideoAsset, TranscriptCue, AppUserRole, AttachStockImageInput, AttachStockCoverInput } from './types';

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
  avatars: (q?: string) => ['tenant', 'avatars', q ?? ''] as const,
  tenantFeeds: ['tenant', 'feeds'] as const,
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

/** Crea un corso da un ARGOMENTO cercato sui feed (semantico + dedup + brief). */
export function useCreateCourseFromRss() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      topic: string;
      title?: string;
      language: string;
      source: 'everywhere' | 'mine';
      category?: FeedCategory;
      audience?: string;
      tone?: string;
      scope?: string;
      preview?: import('./types').RssPreviewResult;
      maxArticles: number;
      lessonFormatDefault?: import('./types').LessonFormatValue;
      lessonFormatHints?: Record<string, import('./types').LessonFormatValue>;
      requestedAssessments?: Array<'intermediate' | 'final'>;
    }) => api.createCourseFromRss(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.courses }),
  });
}

/** Anteprima (pre-sommario) del corso da un argomento. Non crea nulla. */
export function useRssPreview() {
  return useMutation({
    mutationFn: (input: {
      topic: string;
      language: string;
      source: 'everywhere' | 'mine';
      category?: FeedCategory;
      audience?: string;
      tone?: string;
      scope?: string;
    }) => api.previewCourseFromRss(input),
  });
}

/** Anteprima del corso DAL MIO MATERIALE (knowledge selezionata). Non crea nulla. */
export function useKnowledgePreview() {
  return useMutation({
    mutationFn: (input: {
      documentIds: string[];
      language: string;
      topic?: string;
      audience?: string;
      tone?: string;
      scope?: string;
    }) => api.previewCourseFromKnowledge(input),
  });
}

/** Crea un corso DAL MIO MATERIALE (documenti knowledge scelti come fonti). */
export function useCreateCourseFromKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      documentIds: string[];
      language: string;
      topic?: string;
      title?: string;
      audience?: string;
      tone?: string;
      scope?: string;
      preview?: import('./types').RssPreviewResult;
      lessonFormatDefault?: import('./types').LessonFormatValue;
      lessonFormatHints?: Record<string, import('./types').LessonFormatValue>;
      requestedAssessments?: Array<'intermediate' | 'final'>;
    }) => api.createCourseFromKnowledge(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.courses }),
  });
}

/** Feed RSS personalizzati del tenant (lista). */
export function useTenantFeeds() {
  return useQuery({ queryKey: qk.tenantFeeds, queryFn: () => api.listTenantFeeds() });
}

/** Aggiunge un feed personalizzato del tenant. */
export function useAddTenantFeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { url: string; name?: string }) => api.addTenantFeed(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tenantFeeds }),
  });
}

/** Rimuove un feed personalizzato del tenant. */
export function useRemoveTenantFeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.removeTenantFeed(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tenantFeeds }),
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

export const useFolders = (kind: FolderKind = 'COURSE') =>
  useQuery({ queryKey: [...qk.folders, kind], queryFn: () => api.listFolders(kind) });

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; parentId?: string | null; kind?: FolderKind }) => api.createFolder(input),
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
    mutationFn: (settings: { interactionStyle?: 'sober' | 'lively'; navPosition?: 'side' | 'top'; speechEngine?: 'standard' | 'neural' | 'generative'; coverPosition?: number; primaryBrandId?: string; instructor?: { name?: string; role?: string; avatarKey?: string } }) =>
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

/** Assessment completo con le domande (anteprima autore). On-demand. */
export const useAssessment = (courseId: string, assessmentId: string | null) =>
  useQuery({
    queryKey: ['courses', courseId, 'assessment', assessmentId],
    queryFn: () => api.getAssessment(courseId, assessmentId as string),
    enabled: !!courseId && !!assessmentId,
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
    mutationFn: (args: string | { lessonId: string; engine?: 'standard' | 'neural' }) =>
      typeof args === 'string'
        ? api.generateLessonNarration(courseId, args)
        : api.generateLessonNarration(courseId, args.lessonId, args.engine),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.modules(courseId) }),
  });
}

// --- Generazione video avatar (HeyGen) -------------------------------------

/** Avatar disponibili per la generazione video (caricati on demand). */
export function useVideoAvatars(
  courseId: string,
  enabled = true,
  opts?: { source?: 'mine' | 'stock'; q?: string },
) {
  const source = opts?.source ?? 'stock';
  const q = opts?.q ?? '';
  return useInfiniteQuery({
    queryKey: ['courses', courseId, 'video-avatars', source, q] as const,
    queryFn: ({ pageParam }) =>
      api.listVideoAvatars(courseId, { source, q: q || undefined, token: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextToken,
    enabled: !!courseId && enabled,
    staleTime: 10 * 60_000,
  });
}

/** Voci disponibili per la generazione video, PAGINATE (prima pagina veloce +
 *  'Carica altri'). Filtrate per lingua del corso (default) o `language`; `q` cerca. */
export function useVideoVoices(
  courseId: string,
  enabled = true,
  opts?: { language?: string; q?: string },
) {
  const language = opts?.language;
  const q = opts?.q ?? '';
  return useInfiniteQuery({
    queryKey: ['courses', courseId, 'video-voices', language ?? 'course', q] as const,
    queryFn: ({ pageParam }) =>
      api.listVideoVoices(courseId, { language, q: q || undefined, token: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextToken,
    enabled: !!courseId && enabled,
    staleTime: 10 * 60_000,
  });
}

/**
 * Avvia la generazione del video avatar per un concetto. Il rendering prosegue
 * lato server (stato nel payload del block): invalida i moduli così la UI
 * ricarica i block e mostra lo stato 'processing'.
 */
export function useGenerateConceptVideo(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { lessonId: string; blockId: string; avatarId?: string; voiceId?: string; script?: string }) =>
      api.generateConceptVideo(courseId, vars.lessonId, vars.blockId, {
        avatarId: vars.avatarId,
        voiceId: vars.voiceId,
        script: vars.script,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.modules(courseId) }),
  });
}

/**
 * Genera i cartoon delle scene di una pillola (branching_scenario) con Nova
 * Reel. Senza nodeId genera tutte le scene con video segnaposto; con nodeId
 * solo quella scena. Invalida i moduli così la UI mostra processing→ready.
 */
export function useGenerateScenesCartoon(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { lessonId: string; blockId: string; nodeId?: string }) =>
      api.generateScenesCartoon(courseId, vars.lessonId, vars.blockId, vars.nodeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.modules(courseId) }),
  });
}

// --- Gestione avatar HeyGen del tenant (Impostazioni → Avatar) --------------

/** Lista degli avatar dell'account (i "miei"). `q` cerca per nome. */
export function useMyAvatars(q?: string, enabled = true) {
  return useQuery({
    queryKey: qk.avatars(q),
    queryFn: () => api.listMyAvatars(q),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * Forza il refresh della lista avatar bypassando la cache del server (utile
 * dopo aver creato un avatar su HeyGen fuori dalla piattaforma). Esegue una
 * lettura con refresh e poi invalida le query locali così la UI si aggiorna.
 */
export function useRefreshMyAvatars() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (q?: string) => {
      const [mine] = await Promise.all([api.listMyAvatars(q, true), api.listAvatarGroups(true)]);
      return mine;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant', 'avatars'] }),
  });
}

/** Crea un avatar da FOTO (upload immagine). Invalida la lista al termine. */
/** Cosa può creare l'utente corrente nella pagina Avatar. */
export function useAvatarCapabilities() {
  return useQuery({
    queryKey: [...qk.avatars('capabilities')],
    queryFn: () => api.getAvatarCapabilities(),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
/**
 * Avatar dell'account come personaggi, con stato e consenso. Mentre qualcuno è in addestramento o in
 * attesa del consenso si rilegge da solo, così la pagina segue l'avanzamento senza ricaricarla.
 */
export function useAvatarGroups() {
  return useQuery({
    queryKey: [...qk.avatars('groups')],
    queryFn: () => api.listAvatarGroups(),
    staleTime: 15_000,
    refetchInterval: (q) => (q.state.data?.some((g) => g.status === 'processing' || g.status === 'pending_consent') ? 8_000 : false),
    retry: false,
  });
}
/** Crea un digital twin da un video. */
export function useCreateDigitalTwin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; file: File; consentConfirmed: boolean; onProgress?: (fraction: number) => void }) =>
      api.createDigitalTwin(vars.name, vars.file, vars.consentConfirmed, vars.onProgress),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant', 'avatars'] }),
  });
}
/** Aziende e utenti tra cui assegnare un avatar (solo quando si apre l'editor di accesso). */
export function useAvatarAccessTargets(enabled: boolean) {
  return useQuery({
    queryKey: [...qk.avatars('access-targets')],
    queryFn: () => api.getAvatarAccessTargets(),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}
/** Cambia a chi appartiene un avatar. */
export function useSetAvatarAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { groupId: string; tenantId?: string; userIds: string[] }) =>
      api.setAvatarAccess(vars.groupId, { tenantId: vars.tenantId, userIds: vars.userIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant', 'avatars'] }),
  });
}
/** Avvia o rinnova la raccolta del consenso di un digital twin: ritorna il link per la persona. */
export function useRequestAvatarConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => api.requestAvatarConsent(groupId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant', 'avatars'] }),
  });
}
export function useCreatePhotoAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; file: File; consentConfirmed: boolean }) =>
      api.createPhotoAvatar(vars.name, vars.file, vars.consentConfirmed),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant', 'avatars'] }),
  });
}

/** Crea un avatar da PROMPT testuale. Invalida la lista al termine. */
export function useCreatePromptAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; prompt: string }) => api.createPromptAvatar(vars.name, vars.prompt),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant', 'avatars'] }),
  });
}

/** Elimina un avatar del tenant (per groupId). Invalida la lista al termine. */
export function useDeleteAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => api.deleteAvatar(groupId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant', 'avatars'] }),
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

/** Imposta il formato didattico di una lezione (pillola/video_first/standard). */
export function useSetLessonFormat(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { moduleId: string; lessonId: string; format: 'pillola' | 'pillola_interattiva' | 'video_first' | 'standard' }) =>
      api.setLessonFormat(courseId, vars.moduleId, vars.lessonId, vars.format),
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

/** Crea una knowledge strutturata (documento AI) da documenti già caricati. */
export function useStructureKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { documentIds: string[]; title: string; scope: KnowledgeScope; courseId?: string; language?: string }) =>
      api.structureKnowledge(input),
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

export function useReprocessKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.reprocessKnowledge(id),
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

/** Imposta il brand predefinito del tenant (si applica ai corsi senza un brand scelto). */
export function useSetDefaultBrand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (brandId: string | null) => api.setDefaultBrand(brandId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.brands });
      void qc.invalidateQueries({ queryKey: qk.courses });
    },
  });
}
export function useDeleteBrand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteBrand(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.brands }),
  });
}

export function useUploadBrandLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; file: File }) => api.uploadBrandLogo(vars.id, vars.file),
    onSuccess: (brand) => {
      qc.invalidateQueries({ queryKey: qk.brands });
      qc.invalidateQueries({ queryKey: qk.brand(brand.id) });
    },
  });
}

// --- Export / usage / audit -------------------------------------------------

export function useExportCourse(courseId: string) {
  return useMutation({
    mutationFn: (vars: { brandId: string; profile: ScormProfile; allowUnapproved?: boolean; includeSemanticSearch?: boolean }) =>
      api.exportCourse(courseId, vars.brandId, vars.profile, vars.allowUnapproved, vars.includeSemanticSearch),
  });
}

/** Dopo questi errori di fila senza mai una risposta si smette di insistere (circa 2 minuti). */
const WALLET_MAX_ERRORS = 40;

/**
 * Stato del wallet a crediti: saldo, ricarica e se l'azienda paga a crediti. Si aggiorna da solo.
 * Al primo accesso di un nuovo utente il wallet personale lo crea Manager e può servire qualche
 * secondo: finché non arriva una risposta si riprova ogni 3 secondi, senza bisogno di ricaricare.
 */
export const useWallet = () =>
  useQuery({
    queryKey: ['billing', 'wallet'],
    queryFn: () => api.getWallet(),
    staleTime: 15_000,
    refetchInterval: (q) => {
      if (q.state.data?.enabled) return 20_000;
      // Nessuna risposta ancora (wallet in creazione): ritenta spesso, ma non all'infinito.
      if (!q.state.data) return q.state.errorUpdateCount < WALLET_MAX_ERRORS ? 3_000 : false;
      // Wallet non abilitato: ricontrolla di tanto in tanto, se Manager lo attiva.
      return 60_000;
    },
    refetchOnWindowFocus: true,
    // Un errore momentaneo non deve nascondere il wallet fino al ricaricamento della pagina.
    retry: 2,
    retryDelay: (n) => Math.min(1_000 * 2 ** n, 4_000),
  });

/**
 * True mentre il wallet non è ancora pronto: è in creazione (errori o attesa oltre un istante),
 * non quando semplicemente si sta caricando la pagina. Serve a mostrare "wallet in preparazione".
 */
export function useWalletPreparing(): boolean {
  const q = useWallet();
  const [slow, setSlow] = React.useState(false);
  React.useEffect(() => {
    if (q.data) return;
    const t = window.setTimeout(() => setSlow(true), 900);
    return () => window.clearTimeout(t);
  }, [q.data]);
  if (q.data) return false;
  if (q.errorUpdateCount >= WALLET_MAX_ERRORS) return false;
  return slow || q.failureCount > 0 || q.errorUpdateCount > 0;
}

/** Preventivo (tetto garantito) di un corso da creare; solo con i crediti attivi. */
export function useCourseEstimate(input: Partial<CourseEstimateInput> | null) {
  const wallet = useWallet();
  return useQuery({
    queryKey: ['billing', 'estimate', JSON.stringify(input)],
    queryFn: () => api.estimateCourse(input ?? {}),
    enabled: wallet.data?.enabled === true && input !== null,
    staleTime: 60_000,
    retry: false,
  });
}
/** Quanto manca per completare un corso esistente; solo con i crediti attivi. */
export function useExistingCourseEstimate(courseId: string) {
  const wallet = useWallet();
  return useQuery({
    queryKey: ['billing', 'estimate', 'course', courseId],
    queryFn: () => api.estimateExistingCourse(courseId),
    enabled: wallet.data?.enabled === true && Boolean(courseId),
    staleTime: 10_000,
    // Cambia man mano che si generano struttura, lezioni e test.
    refetchInterval: 15_000,
    retry: false,
  });
}
/** Riepilogo della dashboard; si rilegge ogni minuto e quando una generazione è in corso. */
export function useDashboardSummary() {
  return useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => api.getDashboardSummary(),
    staleTime: 20_000,
    refetchInterval: (q) => (q.state.data?.recentCourses.some((c) => c.generating) ? 5_000 : 60_000),
    retry: false,
  });
}
/** Stato della generazione automatica del corso; si aggiorna da solo mentre lavora. */
export function useAutopilot(courseId: string) {
  return useQuery({
    queryKey: ['autopilot', courseId],
    queryFn: () => api.getAutopilot(courseId),
    enabled: Boolean(courseId),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (s === 'running') return 3_000;
      // A lavoro finito i video delle pillole possono essere ancora in rendering.
      if (s === 'completed' && (q.state.data?.progress.videos.processing ?? 0) > 0) return 10_000;
      return false;
    },
    retry: false,
  });
}
/** Azioni sulla generazione automatica: avvio, ripresa dopo la revisione, annullamento, chiusura del riepilogo. */
export function useAutopilotActions(courseId: string) {
  const qc = useQueryClient();
  const set = (v: unknown) => qc.setQueryData(['autopilot', courseId], v);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.modules(courseId) });
    qc.invalidateQueries({ queryKey: qk.course(courseId) });
  };
  return {
    start: useMutation({
      mutationFn: (input: { reviewStructure: boolean; options?: Partial<CourseEstimateOptions>; slides?: StartSlidesAutopilot }) => api.startAutopilot(courseId, input),
      onSuccess: set,
    }),
    resume: useMutation({ mutationFn: () => api.resumeAutopilot(courseId), onSuccess: set }),
    cancel: useMutation({ mutationFn: () => api.cancelAutopilot(courseId), onSuccess: set }),
    dismiss: useMutation({
      mutationFn: () => api.dismissAutopilot(courseId),
      onSuccess: () => {
        set(null);
        refresh();
      },
    }),
  };
}
/** Preventivo massimo di un video da slide prima dei copioni; solo con i crediti attivi. */
export function useSlideImportEstimate(
  courseId: string,
  importId: string,
  sections = false,
  enabled = true,
  opts?: { engine?: string; avatarType?: string },
) {
  const wallet = useWallet();
  return useQuery({
    queryKey: ['billing', 'estimate', 'slides', courseId, importId, sections, opts?.engine ?? '', opts?.avatarType ?? ''],
    queryFn: () => api.estimateSlideImport(courseId, importId, sections, opts),
    enabled: enabled && wallet.data?.enabled === true && Boolean(importId),
    staleTime: 60_000,
    retry: false,
    // Cambiando avatar o qualità il preventivo si aggiorna senza sparire.
    placeholderData: (prev) => prev,
  });
}
/** Prezzi massimi delle operazioni di una lezione (immagini, voce, video animati); solo con i crediti attivi. */
export function useLessonEstimate(courseId: string, lessonId: string, enabled = true) {
  const wallet = useWallet();
  return useQuery({
    queryKey: ['billing', 'estimate', 'lesson', courseId, lessonId],
    queryFn: () => api.estimateLesson(courseId, lessonId),
    enabled: enabled && wallet.data?.enabled === true,
    staleTime: 5_000,
    refetchInterval: 20_000,
    retry: false,
  });
}
/** Conferma il preventivo del corso come budget. */
export function useConfirmCourseBudget(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (options?: Partial<CourseEstimateOptions>) => api.confirmCourseBudget(courseId, options),
    onSuccess: (view) => qc.setQueryData(['billing', 'estimate', 'course', courseId], view),
  });
}
/** Crediti addebitati per un corso (solo con i crediti attivi). */
export const useCourseCredits = (courseId: string, enabled = true) =>
  useQuery({
    queryKey: ['billing', 'course-credits', courseId],
    queryFn: () => api.getCourseCredits(courseId),
    enabled,
    staleTime: 15_000,
  });
/** Movimenti di un wallet (solo quelli che cambiano il saldo), a pagine. */
export const useWalletTransactions = (wallet: 'company' | 'personal', page: number, enabled = true) =>
  useQuery({
    queryKey: ['billing', 'transactions', wallet, page],
    queryFn: () => api.getWalletTransactions(wallet, page),
    enabled,
    staleTime: 10_000,
    retry: false,
  });
/** Cambia il wallet che paga le generazioni (azienda o personale). */
export function useSetWalletPayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payer: 'COMPANY' | 'PERSONAL') => api.setWalletPayer(payer),
    onSuccess: (wallet) => {
      qc.setQueryData(['billing', 'wallet'], wallet);
      qc.invalidateQueries({ queryKey: ['billing', 'quote'] });
    },
  });
}

/** Avvia la ricarica del wallet personale: ritorna l'indirizzo della pagina di pagamento. */
export const useStartWalletTopup = () =>
  useMutation({ mutationFn: (amountEur: number) => api.startWalletTopup(amountEur) });

/** Preventivo in crediti di una generazione; non interroga l'API se l'azienda non paga a crediti. */
export function useCreditQuote(items: CreditQuoteItem[]) {
  const wallet = useWallet();
  const usable = items.filter((i) => i.units === undefined || i.units > 0);
  return useQuery({
    queryKey: ['billing', 'quote', JSON.stringify(usable)],
    queryFn: () => api.quoteCredits(usable),
    enabled: wallet.data?.enabled === true && usable.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
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

export function useUploadBrandingLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.uploadBrandingLogo(file),
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

export function useSetVideoThumbnail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; file: Blob }) => api.setVideoThumbnail(vars.id, vars.file),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.videos }),
  });
}
export function useClearVideoThumbnail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.clearVideoThumbnail(id),
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

/** (Ri)avvia la trascrizione automatica (ASR) del video di un block. */
export function useRetranscribeVideo(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { lessonId: string; blockId: string }) =>
      api.retranscribeVideo(courseId, vars.lessonId, vars.blockId),
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

/** Carica un'immagine dal PC e la collega a un block immagine della lezione. */
export function useUploadBlockImage(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { lessonId: string; blockId: string; file: File; mediaIndex?: number; alt?: string }) =>
      api.uploadBlockImage(courseId, vars.lessonId, {
        blockId: vars.blockId,
        file: vars.file,
        mediaIndex: vars.mediaIndex,
        alt: vars.alt,
      }),
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

/** Carica un'immagine dal PC e la imposta come copertina del corso. */
export function useUploadCover(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.uploadCover(courseId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.course(courseId) }),
  });
}

/** Carica un'immagine dal PC e la imposta come copertina di un modulo. */
export function useUploadModuleCover(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { moduleId: string; file: File }) =>
      api.uploadModuleCover(courseId, vars.moduleId, vars.file),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.modules(courseId) }),
  });
}

// --- Video-lezione da slide (PDF + avatar) ----------------------------------


export const useImportSlides = (courseId: string) =>
  useMutation({ mutationFn: (input: { file: File; language?: string }) => api.importSlides(courseId, input.file, input.language) });

export const useSlideScripts = (courseId: string, importId: string | null) =>
  useQuery({
    queryKey: ['courses', courseId, 'slides', importId, 'scripts'],
    queryFn: () => api.getSlideScripts(courseId, importId as string),
    enabled: !!courseId && !!importId,
    // La generazione gira in background sul server: finché è in corso si interroga lo stato.
    refetchInterval: (query) => (query.state.data?.generation?.status === 'running' ? 4000 : false),
  });

export function useGenerateSlideScripts(courseId: string, importId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (knowledgeDocIds?: string[]) => api.generateSlideScripts(courseId, importId as string, knowledgeDocIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['courses', courseId, 'slides', importId, 'scripts'] }),
  });
}

export function useSaveSlideScripts(courseId: string, importId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { slides: Array<{ index: number; script: string; skip: boolean }>; approved: boolean }) =>
      api.saveSlideScripts(courseId, importId as string, input),
    onSuccess: (doc) => qc.setQueryData(['courses', courseId, 'slides', importId, 'scripts'], doc),
  });
}

export function useSetSlideGlossary(courseId: string, importId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (glossary: PronunciationEntry[]) => api.setSlideGlossary(courseId, importId as string, glossary),
    onSuccess: (doc) => {
      qc.setQueryData(['courses', courseId, 'slides', importId, 'scripts'], doc);
      // Cambia quali clip vanno rigenerate: la stima si ricalcola.
      qc.invalidateQueries({ queryKey: ['courses', courseId, 'slides', importId, 'estimate'] });
    },
  });
}

export const useSlideClipsEstimate = (
  courseId: string,
  importId: string | null,
  engine: string | undefined,
  avatarType: SlideAvatarType,
  enabled: boolean,
  all = false,
) =>
  useQuery({
    queryKey: ['courses', courseId, 'slides', importId, 'estimate', engine ?? 'default', avatarType, all],
    queryFn: () => api.estimateSlideClips(courseId, importId as string, engine, avatarType, all),
    enabled: !!courseId && !!importId && enabled,
  });

/** Stato delle clip: polling mentre il lavoro è in corso (la lettura riprende i lavori orfani). */
export const useSlideClips = (courseId: string, importId: string | null) =>
  useQuery({
    queryKey: ['courses', courseId, 'slides', importId, 'clips'],
    queryFn: () => api.getSlideClips(courseId, importId as string),
    enabled: !!courseId && !!importId,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 5000 : false),
  });

export function useStartSlideClips(courseId: string, importId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StartSlideClipsInput) => api.startSlideClips(courseId, importId as string, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['courses', courseId, 'slides', importId, 'clips'] }),
  });
}

export const useSlideLesson = (courseId: string, importId: string | null) =>
  useQuery({
    queryKey: ['courses', courseId, 'slides', importId, 'lesson'],
    queryFn: () => api.getSlideLesson(courseId, importId as string),
    enabled: !!courseId && !!importId,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 5000 : false),
  });

/** Clip da rifare e rimontaggio in attesa sul video da slide, con il costo complessivo. */
export const useSlideChanges = (courseId: string, importId: string | null) =>
  useQuery({
    queryKey: ['courses', courseId, 'slides', importId, 'changes'],
    queryFn: () => api.getSlideChanges(courseId, importId as string),
    enabled: !!courseId && !!importId,
    staleTime: 5_000,
    refetchInterval: (q) => (q.state.data?.running ? 4000 : 15_000),
  });

/** Applica in blocco le modifiche: rigenera le clip cambiate e rimonta il video. */
export function useApplySlideChanges(courseId: string, importId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.applySlideChanges(courseId, importId as string),
    onSuccess: () => {
      for (const k of ['changes', 'clips', 'lesson']) void qc.invalidateQueries({ queryKey: ['courses', courseId, 'slides', importId, k] });
      void qc.invalidateQueries({ queryKey: ['billing', 'wallet'] });
    },
  });
}

/** Adatta alla durata del video il copione di un elemento (l'AI lo accorcia o lo allunga). */
export function useFitSlideScript(courseId: string, importId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (index: number) => api.fitSlideScript(courseId, importId as string, index),
    onSuccess: (doc) => {
      qc.setQueryData(['courses', courseId, 'slides', importId, 'scripts'], doc);
      void qc.invalidateQueries({ queryKey: ['courses', courseId, 'slides', importId, 'changes'] });
      void qc.invalidateQueries({ queryKey: ['billing', 'wallet'] });
    },
  });
}

/** Da video: come combaciano video e voce di ogni elemento (a clip generate). */
export const useVideoTiming = (courseId: string, importId: string | null, enabled = true) =>
  useQuery({
    queryKey: ['courses', courseId, 'slides', importId, 'timing'],
    queryFn: () => api.getVideoTiming(courseId, importId as string),
    enabled: !!courseId && !!importId && enabled,
    staleTime: 15_000,
  });

export const useProposeSlideSections = (courseId: string, importId: string | null) =>
  useMutation({ mutationFn: () => api.proposeSlideSections(courseId, importId as string) });

export function useBuildSlideLesson(courseId: string, importId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: import('./types').SlideLayoutChoice & { layout: import('./types').SlideLayout; moduleTitle?: string; sections?: Array<{ title: string; from: number }> }) =>
      api.buildSlideLesson(courseId, importId as string, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['courses', courseId, 'slides', importId, 'lesson'] });
    },
  });
}

export const useSlideImport = (courseId: string, importId: string | null) =>
  useQuery({
    queryKey: ['courses', courseId, 'slides', importId, 'import'],
    queryFn: () => api.getSlideImport(courseId, importId as string),
    enabled: !!courseId && !!importId,
    staleTime: 60 * 60_000,
  });

/** Sostituisce le immagini dell'import con un PDF aggiornato (stesse pagine), mantenendo copioni e clip. */
export function useReplaceSlides(courseId: string, importId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.replaceSlides(courseId, importId as string, file),
    onSuccess: (res) => {
      qc.setQueryData(['courses', courseId, 'slides', importId, 'import'], res);
    },
  });
}

/** Rifà i video delle lezioni con le slide aggiornate, senza rigenerare le clip avatar. */
export function useRemasterSlideLesson(courseId: string, importId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input?: import('./types').SlideLayoutChoice) => api.remasterSlideLesson(courseId, importId as string, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['courses', courseId, 'slides', importId, 'lesson'] }),
  });
}

/** Regia automatica (inquadratura e angolo per slide) del layout dinamico. */
export const useSlideDirection = (courseId: string, importId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: ['courses', courseId, 'slides', importId, 'direction'],
    queryFn: () => api.getSlideDirection(courseId, importId as string),
    enabled: !!courseId && !!importId && enabled,
    staleTime: 10 * 60_000,
  });

/** Cambia avatar di un video già generato: rigenera tutte le clip (copioni, slide e regia restano). */
export function useChangeSlideAvatar(courseId: string, importId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StartSlideClipsInput) => api.changeSlideAvatar(courseId, importId as string, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['courses', courseId, 'slides', importId, 'clips'] }),
  });
}

// --- Podcast -----------------------------------------------------------------

export function usePodcasts() {
  return useQuery({ queryKey: ['podcasts'], queryFn: () => api.listPodcasts() });
}

/** Una serie. Si rilegge da sola finché qualche puntata è in lavorazione. */
export function usePodcast(id: string | null) {
  return useQuery({
    queryKey: ['podcasts', id],
    queryFn: () => api.getPodcast(id!),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const busy = query.state.data?.episodes.some((e) => e.state === 'WRITING' || e.state === 'VOICING');
      return busy ? 3000 : false;
    },
  });
}

export function usePodcastVoices(language: string) {
  return useQuery({ queryKey: ['podcasts', 'voices', language], queryFn: () => api.listPodcastVoices(language), staleTime: 5 * 60_000 });
}

/** Se l'utente può creare voci nuove (HeyGen). */
export function usePodcastVoiceCapabilities() {
  return useQuery({ queryKey: ['podcasts', 'voices', 'capabilities'], queryFn: () => api.getPodcastVoiceCapabilities(), staleTime: 10 * 60_000 });
}

/** Costo di una nuova puntata (copione e audio). */
export function usePodcastEstimateNew(minutes: number) {
  return useQuery({
    queryKey: ['podcasts', 'estimate-new', minutes],
    queryFn: () => api.estimateNewPodcast(minutes),
    staleTime: 30_000,
  });
}

export function usePodcastEstimate(id: string | null) {
  return useQuery({ queryKey: ['podcasts', id, 'estimate'], queryFn: () => api.estimatePodcast(id!), enabled: Boolean(id) });
}

export function useCreatePodcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePodcast) => api.createPodcast(input),
    onSuccess: (view) => {
      qc.setQueryData(['podcasts', view.id], view);
      qc.invalidateQueries({ queryKey: ['podcasts'] });
    },
  });
}

export function useDeletePodcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePodcast(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['podcasts'] }),
  });
}

/** Azioni su una serie: ognuna restituisce la serie aggiornata e la mette subito in cache. */
export function usePodcastActions(id: string) {
  const qc = useQueryClient();
  const done = (view: PodcastView | void): void => {
    if (view) qc.setQueryData(['podcasts', id], view);
    qc.invalidateQueries({ queryKey: ['podcasts', id, 'estimate'] });
    qc.invalidateQueries({ queryKey: ['podcasts'], exact: true });
  };
  return {
    update: useMutation({ mutationFn: (input: UpdatePodcast) => api.updatePodcast(id, input), onSuccess: done }),
    addEpisode: useMutation({ mutationFn: (input: CreatePodcastEpisode) => api.addPodcastEpisode(id, input), onSuccess: done }),
    ideas: useMutation({ mutationFn: (input: SuggestPodcastIdeas) => api.suggestPodcastIdeas(id, input) }),
    saveEpisodes: useMutation({ mutationFn: (input: UpdatePodcastEpisodes) => api.updatePodcastEpisodes(id, input), onSuccess: done }),
    writeScripts: useMutation({ mutationFn: (episodeIds?: string[]) => api.writePodcastScripts(id, episodeIds), onSuccess: done }),
    saveScript: useMutation({ mutationFn: (v: { episodeId: string; script: PodcastScript }) => api.updatePodcastScript(id, v.episodeId, v.script), onSuccess: done }),
    recordAudio: useMutation({ mutationFn: (episodeIds?: string[]) => api.recordPodcastAudio(id, episodeIds), onSuccess: done }),
    cancel: useMutation({ mutationFn: () => api.cancelPodcastWork(id) }),
    publish: useMutation({ mutationFn: (episodeId: string) => api.publishPodcastEpisode(id, episodeId), onSuccess: done }),
    unpublish: useMutation({ mutationFn: (episodeId: string) => api.unpublishPodcastEpisode(id, episodeId), onSuccess: done }),
    setFeed: useMutation({ mutationFn: (visibility: PodcastFeedVisibility) => api.setPodcastFeed(id, visibility), onSuccess: done }),
    rotateToken: useMutation({ mutationFn: () => api.rotatePodcastFeedToken(id), onSuccess: done }),
    uploadCover: useMutation({ mutationFn: (file: File) => api.uploadPodcastCover(id, file), onSuccess: done }),
  };
}

/** Sposta una serie in una cartella (null = radice). */
export function useMovePodcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { podcastId: string; folderId: string | null }) => api.movePodcast(vars.podcastId, vars.folderId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['podcasts'] });
      qc.invalidateQueries({ queryKey: qk.folders });
    },
  });
}
