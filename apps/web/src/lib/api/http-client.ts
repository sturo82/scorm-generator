import type { PodcastVoiceProvider, CreatePodcast, CreatePodcastEpisode, PodcastIdea, SuggestPodcastIdeas, PodcastEstimateView, PodcastListItem, PodcastScript, PodcastView, PodcastVoiceOption, PodcastFeedVisibility, UpdatePodcast, UpdatePodcastEpisodes } from '@scorm/contracts';
import type { StartSlidesAutopilot, DashboardSummary, AutopilotView, Assessment, Block, Brief, BriefDraft, CreditQuoteItem, CourseCreditsView, CourseEstimateInput, CourseEstimateOptions, CourseEstimateView, LessonEstimateView, SlideImportEstimateView, CreditQuoteView, FeedCategory, WalletTransactionsView, WalletView } from '@scorm/contracts';
import { confirmOverBudget, notifyInsufficientCredits, parseOverBudget } from '../billing-events';
import { getSession, handleSessionExpired } from '../auth';
import type {
  AdminUserView,
  ApiClient,
  AppUserRole,
  AssessmentIndexView,
  AuditEventView,
  BrandView,
  CourseView,
  EditorialStatus,
  ExportResultView,
  JobRef,
  CreateCourseFromRssResult,
  CreateCourseFromKnowledgeResult,
  RssPreviewResult,
  LessonFormatValue,
  TenantFeedView,
  JobView,
  KnowledgeDocView,
  KnowledgeScope,
  LessonView,
  ModuleView,
  ScormProfile,
  UsageView,
  CourseCostSummary,
  CourseQuoteView,
  PricingQuoteInput,
  FolderView,
  FolderKind,
  CreateFolder,
  UpdateFolder,
  AppBrandingView,
  UpdateAppBranding,
  VideoAssetView,
  CreateExternalVideo,
  UpdateVideoAsset,
  TranscriptCue,
  StockImageSearchResponse,
  AttachStockImageInput,
  AttachStockCoverInput,
  SsoRedeemResult,
  AvatarOption,
  AvatarGroupView,
  AvatarAccessTargets,
  AvatarAccessView,
  AvatarConsentRequest,
  VoiceOption,
  GenerateVideoRef,
  CreateAvatarResult,
  AvatarLookStatus,
  Page,
  SlideImportView,
  SlideScriptsDoc,
  SlideClipsEstimate,
  SlideChangesView,
  VideoTiming,
  SlideClipsView,
  StartSlideClipsInput,
  SlideLessonView,
  SlideAvatarType,
  SlideSection,
  PronunciationEntry,
  SlideScriptsGeneration,
  SlideScriptsResponse,
  SlideLayoutChoice,
  SlideLayout,
  SlideDirectionItem,
} from './types';

/**
 * Client HTTP reale verso apps/api. Allega il Bearer token della sessione dev e
 * un correlation id. Si attiva con NEXT_PUBLIC_API_MODE=real.
 */
export class HttpApiClient implements ApiClient {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit, creditConfirm?: number): Promise<T> {
    const session = getSession();
    const headers = new Headers(init?.headers);
    // Crediti oltre il preventivo del corso già confermati dall'utente (vedi 409 over_budget).
    if (creditConfirm) headers.set('x-credit-confirm', String(creditConfirm));
    headers.set('Content-Type', 'application/json');
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    headers.set('x-correlation-id', crypto.randomUUID());

    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!res.ok) {
      // Sessione scaduta/non valida: logout automatico + redirect al login,
      // invece di propagare errori fuorvianti (es. "corso non trovato").
      if (res.status === 401) void handleSessionExpired();
      const body = await res.text();
      // Crediti insufficienti: avviso globale con il link di ricarica (vedi InsufficientCreditsDialog).
      if (res.status === 402) notifyInsufficientCredits(body);
      // Fuori preventivo del corso: si chiede conferma e, se confermato, si ripete la richiesta.
      const over = res.status === 409 && !creditConfirm ? parseOverBudget(body) : null;
      if (over) {
        if (await confirmOverBudget(over)) return this.request<T>(path, init, over.over);
        throw new Error('Operazione annullata: supera il preventivo del corso');
      }
      throw new Error(`API ${res.status}: ${body.slice(0, 300)}`);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  listCourses(filter?: { folderId?: string | 'root'; q?: string }) {
    const qs = new URLSearchParams();
    if (filter?.folderId !== undefined) qs.set('folderId', filter.folderId);
    if (filter?.q) qs.set('q', filter.q);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request<CourseView[]>(`/courses${suffix}`);
  }
  getCourse(id: string) { return this.request<CourseView>(`/courses/${id}`); }
  createCourse(input: { title: string; description?: string; language: string }) {
    return this.request<CourseView>('/courses', { method: 'POST', body: JSON.stringify(input) });
  }
  createCourseFromRss(input: { topic: string; title?: string; language: string; source: 'everywhere' | 'mine'; category?: FeedCategory; audience?: string; tone?: string; scope?: string; preview?: RssPreviewResult; maxArticles: number; lessonFormatDefault?: LessonFormatValue; lessonFormatHints?: Record<string, LessonFormatValue>; requestedAssessments?: Array<'intermediate' | 'final'> }) {
    return this.request<CreateCourseFromRssResult>('/courses/from-rss', { method: 'POST', body: JSON.stringify(input) });
  }
  previewCourseFromRss(input: { topic: string; language: string; source: 'everywhere' | 'mine'; category?: FeedCategory; audience?: string; tone?: string; scope?: string }) {
    return this.request<RssPreviewResult>('/courses/from-rss/preview', { method: 'POST', body: JSON.stringify(input) });
  }
  previewCourseFromKnowledge(input: { documentIds: string[]; language: string; topic?: string; audience?: string; tone?: string; scope?: string }) {
    return this.request<RssPreviewResult>('/courses/from-knowledge/preview', { method: 'POST', body: JSON.stringify(input) });
  }
  createCourseFromKnowledge(input: { documentIds: string[]; language: string; topic?: string; title?: string; audience?: string; tone?: string; scope?: string; preview?: RssPreviewResult; lessonFormatDefault?: LessonFormatValue; lessonFormatHints?: Record<string, LessonFormatValue>; requestedAssessments?: Array<'intermediate' | 'final'> }) {
    return this.request<CreateCourseFromKnowledgeResult>('/courses/from-knowledge', { method: 'POST', body: JSON.stringify(input) });
  }
  listTenantFeeds() {
    return this.request<TenantFeedView[]>('/tenant/feeds');
  }
  addTenantFeed(input: { url: string; name?: string }) {
    return this.request<TenantFeedView>('/tenant/feeds', { method: 'POST', body: JSON.stringify(input) });
  }
  async removeTenantFeed(id: string) {
    await this.request<{ deleted: boolean }>(`/tenant/feeds/${id}`, { method: 'DELETE' });
  }
  async deleteCourse(id: string) { await this.request(`/courses/${id}`, { method: 'DELETE' }); }
  saveBrief(courseId: string, brief: Brief) {
    return this.request<CourseView>(`/courses/${courseId}/brief`, { method: 'PUT', body: JSON.stringify(brief) });
  }
  saveBriefDraft(courseId: string, draft: BriefDraft) {
    return this.request<CourseView>(`/courses/${courseId}/brief/draft`, { method: 'PUT', body: JSON.stringify(draft) });
  }
  updateCourseSettings(courseId: string, settings: { interactionStyle?: 'sober' | 'lively'; navPosition?: 'side' | 'top'; speechEngine?: 'standard' | 'neural' | 'generative'; coverPosition?: number; primaryBrandId?: string; instructor?: { name?: string; role?: string; avatarKey?: string } }) {
    return this.request<CourseView>(`/courses/${courseId}/settings`, { method: 'PUT', body: JSON.stringify(settings) });
  }
  setCourseShareable(courseId: string, shareable: boolean) {
    return this.request<CourseView>(`/courses/${courseId}/shareable`, { method: 'PUT', body: JSON.stringify({ shareable }) });
  }
  async uploadInstructorAvatar(courseId: string, file: File) {
    const session = getSession();
    const form = new FormData();
    form.append('file', file);
    const headers = new Headers();
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    const res = await fetch(`${this.baseUrl}/courses/${courseId}/instructor/avatar`, { method: 'POST', headers, body: form });
    if (res.status === 401) void handleSessionExpired();
    if (!res.ok) throw new Error(`Upload foto fallito: ${res.status}`);
    return (await res.json()) as { avatarKey: string; avatarUrl: string };
  }
  listModules(courseId: string) { return this.request<ModuleView[]>(`/courses/${courseId}/modules`); }
  listAssessments(courseId: string) { return this.request<AssessmentIndexView[]>(`/courses/${courseId}/assessments`); }
  getAssessment(courseId: string, assessmentId: string) {
    return this.request<Assessment>(`/courses/${courseId}/assessments/${assessmentId}`);
  }
  async deleteAssessment(courseId: string, assessmentId: string) {
    await this.request<{ deleted: boolean }>(`/courses/${courseId}/assessments/${assessmentId}`, { method: 'DELETE' });
  }
  repairAssessments(courseId: string) {
    return this.request<{ linked: number; removedDuplicates: number }>(
      `/courses/${courseId}/assessments/repair`,
      { method: 'POST' },
    );
  }
  generateAssessment(courseId: string, input: { scope: 'intermediate' | 'final'; moduleId?: string; focus?: string }) {
    return this.request<JobRef>(`/courses/${courseId}/generate/assessment`, { method: 'POST', body: JSON.stringify(input) });
  }
  addModule(courseId: string, input: { title: string; summary?: string }) {
    return this.request<ModuleView>(`/courses/${courseId}/modules`, { method: 'POST', body: JSON.stringify(input) });
  }
  addLesson(courseId: string, moduleId: string, input: { title: string }) {
    return this.request<LessonView>(`/courses/${courseId}/modules/${moduleId}/lessons`, { method: 'POST', body: JSON.stringify(input) });
  }
  async deleteModule(courseId: string, moduleId: string) {
    await this.request(`/courses/${courseId}/modules/${moduleId}`, { method: 'DELETE' });
  }
  async deleteLesson(courseId: string, moduleId: string, lessonId: string) {
    await this.request(`/courses/${courseId}/modules/${moduleId}/lessons/${lessonId}`, { method: 'DELETE' });
  }
  applyOutline(courseId: string) {
    return this.request<ModuleView[]>(`/courses/${courseId}/outline/apply`, { method: 'POST' });
  }
  generateOutline(courseId: string) {
    return this.request<JobRef>(`/courses/${courseId}/generate/outline`, { method: 'POST' });
  }
  generateAllContent(courseId: string) {
    return this.request<JobRef>(`/courses/${courseId}/generate/content/all`, { method: 'POST' });
  }
  generateAllAssessments(courseId: string) {
    return this.request<JobRef>(`/courses/${courseId}/generate/assessment/all`, { method: 'POST' });
  }
  listActiveCourseIds() {
    return this.request<Array<{ courseId: string; jobs: number }>>('/jobs/active');
  }
  async uploadLessonVideo(courseId: string, lessonId: string, blockId: string, file: File) {
    const session = getSession();
    const form = new FormData();
    form.append('file', file);
    const headers = new Headers();
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    const res = await fetch(
      `${this.baseUrl}/courses/${courseId}/generate/lessons/${lessonId}/blocks/${blockId}/video`,
      { method: 'POST', headers, body: form },
    );
    if (res.status === 401) void handleSessionExpired();
    if (!res.ok) throw new Error(`Upload video fallito: ${res.status}`);
    return (await res.json()) as { storageKey: string; url: string };
  }
  /** Carica un'immagine dal PC e la collega a un block immagine della lezione. */
  async uploadBlockImage(
    courseId: string,
    lessonId: string,
    input: { blockId: string; file: File; mediaIndex?: number; alt?: string },
  ) {
    const session = getSession();
    const form = new FormData();
    form.append('file', input.file);
    form.append('blockId', input.blockId);
    if (input.mediaIndex != null) form.append('mediaIndex', String(input.mediaIndex));
    if (input.alt) form.append('alt', input.alt);
    const headers = new Headers();
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    const res = await fetch(
      `${this.baseUrl}/courses/${courseId}/stock-images/lessons/${lessonId}/upload`,
      { method: 'POST', headers, body: form },
    );
    if (res.status === 401) void handleSessionExpired();
    if (!res.ok) throw new Error(`Upload immagine fallito: ${res.status}`);
    return (await res.json()) as { attached: true; url: string };
  }
  generateLessonContent(courseId: string, lessonId: string, toneInstruction?: string) {
    return this.request<JobRef>(`/courses/${courseId}/generate/lessons/${lessonId}/content`, {
      method: 'POST',
      body: JSON.stringify({ toneInstruction }),
    });
  }
  generateLessonImages(courseId: string, lessonId: string) {
    return this.request<{ generated: number; skipped: number; failed: number; warnings: string[] }>(
      `/courses/${courseId}/generate/lessons/${lessonId}/images`,
      { method: 'POST' },
    );
  }
  generateLessonNarration(courseId: string, lessonId: string, engine?: 'standard' | 'neural') {
    return this.request<{ url: string; bytes: number; voice: string }>(
      `/courses/${courseId}/generate/lessons/${lessonId}/narration`,
      { method: 'POST', body: JSON.stringify(engine ? { engine } : {}) },
    );
  }
  generateCover(courseId: string) {
    return this.request<{ url: string }>(`/courses/${courseId}/generate/cover`, { method: 'POST' });
  }
  generateModuleCover(courseId: string, moduleId: string) {
    return this.request<{ url: string }>(`/courses/${courseId}/generate/modules/${moduleId}/cover`, { method: 'POST' });
  }
  getJob(courseId: string, jobId: string) {
    return this.request<JobView>(`/courses/${courseId}/jobs/${jobId}`);
  }
  listActiveJobs(courseId: string) {
    return this.request<JobView[]>(`/courses/${courseId}/jobs`);
  }
  editLessonBlocks(courseId: string, lessonId: string, blocks: Block[], expectedUpdatedAt: string) {
    return this.request<LessonView>(`/courses/${courseId}/lessons/${lessonId}/blocks`, {
      method: 'PUT',
      body: JSON.stringify({ blocks, expectedUpdatedAt }),
    });
  }
  async setStatus(courseId: string, entity: string, entityId: string, status: EditorialStatus) {
    await this.request(`/courses/${courseId}/${entity}/${entityId}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
  }
  setStatusAll(courseId: string, status: EditorialStatus) {
    return this.request<{ modules: number; lessons: number; assessments: number }>(
      `/courses/${courseId}/status/all`,
      { method: 'PUT', body: JSON.stringify({ status }) },
    );
  }
  async setLessonVideoFirst(courseId: string, moduleId: string, lessonId: string, videoFirst: boolean) {
    await this.request(
      `/courses/${courseId}/modules/${moduleId}/lessons/${lessonId}/video-first`,
      { method: 'PUT', body: JSON.stringify({ videoFirst }) },
    );
  }

  async setLessonFormat(
    courseId: string,
    moduleId: string,
    lessonId: string,
    format: 'pillola' | 'pillola_interattiva' | 'video_first' | 'standard',
  ) {
    await this.request(
      `/courses/${courseId}/modules/${moduleId}/lessons/${lessonId}/format`,
      { method: 'PUT', body: JSON.stringify({ format }) },
    );
  }
  getRagChunks(courseId: string) {
    return this.request<Array<{ text: string; documentName: string; section?: string }>>(
      `/courses/${courseId}/rag-chunks`,
    );
  }
  getRagEmbeddings(courseId: string) {
    return this.request<import('./types').RagEmbeddingsView>(
      `/courses/${courseId}/rag-chunks/embeddings`,
    );
  }
  listKnowledge(scope?: KnowledgeScope, courseId?: string) {
    const q = new URLSearchParams();
    if (scope) q.set('scope', scope);
    if (courseId) q.set('courseId', courseId);
    return this.request<KnowledgeDocView[]>(`/knowledge?${q.toString()}`);
  }
  async uploadKnowledge(file: File, scope: KnowledgeScope, courseId?: string) {
    const session = getSession();
    const form = new FormData();
    form.append('file', file);
    const q = new URLSearchParams({ scope });
    if (courseId) q.set('courseId', courseId);
    const headers = new Headers();
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    const res = await fetch(`${this.baseUrl}/knowledge/upload?${q.toString()}`, { method: 'POST', headers, body: form });
    if (res.status === 401) void handleSessionExpired();
    if (!res.ok) throw new Error(`Upload fallito: ${res.status}`);
    return (await res.json()) as KnowledgeDocView;
  }
  structureKnowledge(input: { documentIds: string[]; title: string; scope: KnowledgeScope; courseId?: string; language?: string }) {
    return this.request<KnowledgeDocView>('/knowledge/structure', { method: 'POST', body: JSON.stringify(input) });
  }
  async deleteKnowledge(id: string) { await this.request(`/knowledge/${id}`, { method: 'DELETE' }); }
  reprocessKnowledge(id: string) { return this.request<KnowledgeDocView>(`/knowledge/${id}/reprocess`, { method: 'POST' }); }
  async getKnowledgeDownloadUrl(id: string) {
    const { url } = await this.request<{ url: string }>(`/knowledge/${id}/download-url`);
    return url;
  }
  listBrands() { return this.request<BrandView[]>('/brands'); }
  setDefaultBrand(brandId: string | null) {
    return this.request<{ defaultBrandId: string | null }>('/brands/default', { method: 'PUT', body: JSON.stringify({ brandId }) });
  }
  getBrand(id: string) { return this.request<BrandView>(`/brands/${id}`); }
  createBrand(def: Omit<BrandView, 'id' | 'tenantId'>) {
    return this.request<BrandView>('/brands', { method: 'POST', body: JSON.stringify(def) });
  }
  updateBrand(id: string, def: Omit<BrandView, 'id' | 'tenantId'>) {
    return this.request<BrandView>(`/brands/${id}`, { method: 'PUT', body: JSON.stringify(def) });
  }
  async deleteBrand(id: string) { await this.request(`/brands/${id}`, { method: 'DELETE' }); }
  async uploadBrandLogo(id: string, file: File) {
    const session = getSession();
    const form = new FormData();
    form.append('file', file);
    const headers = new Headers();
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    const res = await fetch(`${this.baseUrl}/brands/${id}/logo`, { method: 'POST', headers, body: form });
    if (res.status === 401) void handleSessionExpired();
    if (!res.ok) throw new Error(`Upload logo fallito: ${res.status}`);
    return (await res.json()) as BrandView;
  }
  exportCourse(courseId: string, brandId: string, profile: ScormProfile, allowUnapproved?: boolean, includeSemanticSearch?: boolean) {
    return this.request<ExportResultView>(`/courses/${courseId}/export`, {
      method: 'POST',
      body: JSON.stringify({ brandId, profile, allowUnapproved, includeSemanticSearch }),
    });
  }
  getUsage() { return this.request<UsageView>('/usage'); }
  getWallet() { return this.request<WalletView>('/billing/wallet'); }
  estimateCourse(input: Partial<CourseEstimateInput>) {
    return this.request<CourseEstimateView>('/billing/estimate', { method: 'POST', body: JSON.stringify(input) });
  }
  estimateExistingCourse(courseId: string) {
    return this.request<CourseEstimateView>(`/billing/estimate/courses/${encodeURIComponent(courseId)}`);
  }
  getDashboardSummary() {
    return this.request<DashboardSummary>('/dashboard/summary');
  }
  getAutopilot(courseId: string) {
    return this.request<AutopilotView | null>(`/courses/${encodeURIComponent(courseId)}/autopilot`);
  }
  startAutopilot(courseId: string, input: { reviewStructure: boolean; options?: Partial<CourseEstimateOptions>; slides?: StartSlidesAutopilot }) {
    return this.request<AutopilotView>(`/courses/${encodeURIComponent(courseId)}/autopilot`, { method: 'POST', body: JSON.stringify(input) });
  }
  resumeAutopilot(courseId: string) {
    return this.request<AutopilotView>(`/courses/${encodeURIComponent(courseId)}/autopilot/resume`, { method: 'POST' });
  }
  cancelAutopilot(courseId: string) {
    return this.request<AutopilotView>(`/courses/${encodeURIComponent(courseId)}/autopilot/cancel`, { method: 'POST' });
  }
  dismissAutopilot(courseId: string) {
    return this.request<void>(`/courses/${encodeURIComponent(courseId)}/autopilot/dismiss`, { method: 'POST' });
  }
  estimateSlideImport(courseId: string, importId: string, sections: boolean, opts?: { engine?: string; avatarType?: string }) {
    const q = new URLSearchParams({ sections: String(sections) });
    if (opts?.engine) q.set('engine', opts.engine);
    if (opts?.avatarType) q.set('avatarType', opts.avatarType);
    return this.request<SlideImportEstimateView>(
      `/courses/${encodeURIComponent(courseId)}/slides/imports/${encodeURIComponent(importId)}/estimate?${q.toString()}`,
    );
  }
  estimateLesson(courseId: string, lessonId: string) {
    return this.request<LessonEstimateView>(`/billing/estimate/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`);
  }
  confirmCourseBudget(courseId: string, options?: Partial<CourseEstimateOptions>) {
    return this.request<CourseEstimateView>(`/billing/courses/${encodeURIComponent(courseId)}/budget/confirm`, {
      method: 'POST',
      body: JSON.stringify({ options }),
    });
  }
  getCourseCredits(courseId: string) {
    return this.request<CourseCreditsView>(`/billing/courses/${encodeURIComponent(courseId)}`);
  }
  getWalletTransactions(wallet: 'company' | 'personal', page: number) {
    return this.request<WalletTransactionsView>(`/billing/transactions?wallet=${wallet}&page=${page}`);
  }
  getSignupConfig() {
    return this.request<{ enabled: boolean; captcha: { provider: 'turnstile'; siteKey: string } | null }>('/public/signup-config');
  }
  signup(input: { email: string; captchaToken?: string; website?: string }) {
    return this.request<{ ok: true }>('/public/signup', { method: 'POST', body: JSON.stringify(input) });
  }
  setWalletPayer(payer: 'COMPANY' | 'PERSONAL') {
    return this.request<WalletView>('/billing/payer', { method: 'PUT', body: JSON.stringify({ payer }) });
  }
  startWalletTopup(amountEur: number) {
    return this.request<{ url: string; testMode: boolean }>('/billing/topup', { method: 'POST', body: JSON.stringify({ amountEur }) });
  }
  quoteCredits(items: CreditQuoteItem[]) {
    return this.request<CreditQuoteView>('/billing/quote', { method: 'POST', body: JSON.stringify({ items }) });
  }
  listAudit() { return this.request<AuditEventView[]>('/audit'); }
  getCourseCost(courseId: string) {
    return this.request<CourseCostSummary>(`/courses/${courseId}/cost`);
  }
  getCourseQuote(courseId: string, input: PricingQuoteInput) {
    return this.request<CourseQuoteView>(`/courses/${courseId}/cost/quote`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  listFolders(kind: FolderKind = 'COURSE') { return this.request<FolderView[]>(`/folders?kind=${kind}`); }
  createFolder(input: CreateFolder) {
    return this.request<FolderView>('/folders', { method: 'POST', body: JSON.stringify(input) });
  }
  updateFolder(id: string, input: UpdateFolder) {
    return this.request<FolderView>(`/folders/${id}`, { method: 'PUT', body: JSON.stringify(input) });
  }
  async deleteFolder(id: string) { await this.request(`/folders/${id}`, { method: 'DELETE' }); }
  async movePodcast(podcastId: string, folderId: string | null) {
    await this.request(`/podcasts/${podcastId}/folder`, { method: 'PUT', body: JSON.stringify({ folderId }) });
  }
  async moveCourse(courseId: string, folderId: string | null) {
    await this.request(`/courses/${courseId}/folder`, { method: 'PUT', body: JSON.stringify({ folderId }) });
  }
  listUsers() { return this.request<AdminUserView[]>('/admin/users'); }
  createUser(input: { email: string; displayName?: string; role: AppUserRole }) {
    return this.request<AdminUserView>('/admin/users', { method: 'POST', body: JSON.stringify(input) });
  }
  getBranding() { return this.request<AppBrandingView>('/tenant/branding'); }
  updateBranding(patch: UpdateAppBranding) {
    return this.request<AppBrandingView>('/tenant/branding', { method: 'PUT', body: JSON.stringify(patch) });
  }
  async uploadBrandingLogo(file: File) {
    const session = getSession();
    const form = new FormData();
    form.append('file', file);
    const headers = new Headers();
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    const res = await fetch(`${this.baseUrl}/tenant/branding/logo`, { method: 'POST', headers, body: form });
    if (res.status === 401) void handleSessionExpired();
    if (!res.ok) throw new Error(`Upload logo fallito: ${res.status}`);
    return (await res.json()) as AppBrandingView;
  }

  // Libreria video per-tenant
  listVideos(filter?: { source?: string; channel?: string }) {
    const qs = new URLSearchParams();
    if (filter?.source) qs.set('source', filter.source);
    if (filter?.channel) qs.set('channel', filter.channel);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request<VideoAssetView[]>(`/videos${suffix}`);
  }
  listVideoChannels() { return this.request<string[]>('/videos/channels'); }
  createExternalVideo(input: CreateExternalVideo) {
    return this.request<VideoAssetView>('/videos/external', { method: 'POST', body: JSON.stringify(input) });
  }
  async uploadVideoAsset(file: File, meta?: { title?: string; channel?: string }) {
    const session = getSession();
    const form = new FormData();
    form.append('file', file);
    if (meta?.title) form.append('title', meta.title);
    if (meta?.channel) form.append('channel', meta.channel);
    const headers = new Headers();
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    const res = await fetch(`${this.baseUrl}/videos/upload`, { method: 'POST', headers, body: form });
    if (res.status === 401) void handleSessionExpired();
    if (!res.ok) throw new Error(`Upload video fallito: ${res.status}`);
    return (await res.json()) as VideoAssetView;
  }
  async setVideoThumbnail(id: string, file: Blob) {
    const session = getSession();
    const form = new FormData();
    form.append('file', file, 'thumbnail');
    const headers = new Headers();
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    const res = await fetch(`${this.baseUrl}/videos/${id}/thumbnail`, { method: 'PUT', headers, body: form });
    if (res.status === 401) void handleSessionExpired();
    if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as VideoAssetView;
  }
  clearVideoThumbnail(id: string) {
    return this.request<VideoAssetView>(`/videos/${id}/thumbnail`, { method: 'DELETE' });
  }
  updateVideoAsset(id: string, input: UpdateVideoAsset) {
    return this.request<VideoAssetView>(`/videos/${id}`, { method: 'PUT', body: JSON.stringify(input) });
  }
  async deleteVideoAsset(id: string) {
    await this.request<{ deleted: boolean }>(`/videos/${id}`, { method: 'DELETE' });
  }
  async attachVideoFromLibrary(courseId: string, lessonId: string, blockId: string, videoAssetId: string) {
    await this.request<{ attached: boolean }>(
      `/courses/${courseId}/generate/lessons/${lessonId}/blocks/${blockId}/video/from-library`,
      { method: 'POST', body: JSON.stringify({ videoAssetId }) },
    );
  }
  async setVideoTranscript(courseId: string, lessonId: string, blockId: string, transcript: TranscriptCue[]) {
    await this.request<{ saved: boolean; count: number }>(
      `/courses/${courseId}/generate/lessons/${lessonId}/blocks/${blockId}/transcript`,
      { method: 'PUT', body: JSON.stringify({ transcript }) },
    );
  }
  retranscribeVideo(courseId: string, lessonId: string, blockId: string) {
    return this.request<{ status: 'processing' }>(
      `/courses/${courseId}/generate/lessons/${lessonId}/blocks/${blockId}/transcribe`,
      { method: 'POST' },
    );
  }

  // Generazione video con avatar parlante (HeyGen)
  listVideoAvatars(courseId: string, opts?: { source?: 'mine' | 'stock'; token?: string; q?: string }) {
    const qs = new URLSearchParams();
    if (opts?.source) qs.set('source', opts.source);
    if (opts?.token) qs.set('token', opts.token);
    if (opts?.q) qs.set('q', opts.q);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request<Page<AvatarOption>>(`/courses/${courseId}/generate/video/avatars${suffix}`);
  }
  listVideoVoices(courseId: string, opts?: { language?: string; token?: string; q?: string }) {
    const qs = new URLSearchParams();
    if (opts?.language) qs.set('language', opts.language);
    if (opts?.token) qs.set('token', opts.token);
    if (opts?.q) qs.set('q', opts.q);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request<Page<VoiceOption>>(`/courses/${courseId}/generate/video/voices${suffix}`);
  }
  generateConceptVideo(
    courseId: string,
    lessonId: string,
    blockId: string,
    input?: { avatarId?: string; voiceId?: string; script?: string },
  ) {
    return this.request<GenerateVideoRef>(
      `/courses/${courseId}/generate/lessons/${lessonId}/blocks/${blockId}/video/heygen`,
      { method: 'POST', body: JSON.stringify(input ?? {}) },
    );
  }
  generateScenesCartoon(courseId: string, lessonId: string, blockId: string, nodeId?: string) {
    const path = nodeId
      ? `/courses/${courseId}/generate/lessons/${lessonId}/blocks/${blockId}/scenes/${nodeId}/cartoon`
      : `/courses/${courseId}/generate/lessons/${lessonId}/blocks/${blockId}/cartoon`;
    return this.request<{ started: number; remainingThisMonth: number }>(path, { method: 'POST' });
  }

  // Gestione avatar HeyGen del tenant (Impostazioni → Avatar)
  listMyAvatars(q?: string, refresh?: boolean) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (refresh) params.set('refresh', 'true');
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.request<Page<AvatarOption>>(`/tenant/avatars${suffix}`);
  }
  getAvatarCapabilities() {
    return this.request<{ canCreateTwin: boolean }>('/tenant/avatars/capabilities');
  }
  listAvatarGroups(refresh?: boolean) {
    return this.request<AvatarGroupView[]>(`/tenant/avatars/groups${refresh ? '?refresh=true' : ''}`);
  }
  getAvatarAccessTargets() {
    return this.request<AvatarAccessTargets>('/tenant/avatars/access/targets');
  }
  setAvatarAccess(groupId: string, input: { tenantId?: string; userIds: string[] }) {
    return this.request<AvatarAccessView>(`/tenant/avatars/${encodeURIComponent(groupId)}/access`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }
  requestAvatarConsent(groupId: string) {
    return this.request<AvatarConsentRequest>(`/tenant/avatars/${encodeURIComponent(groupId)}/consent`, { method: 'POST' });
  }
  createPhotoAvatar(name: string, file: File, consentConfirmed: boolean) {
    return this.uploadAvatar('photo', name, file, consentConfirmed);
  }
  /**
   * Digital twin da un video: il file passa a pezzi da 8 MB (una richiesta breve per pezzo, con nuovi
   * tentativi) e solo alla fine si chiede di creare l'avatar. L'avanzamento copre l'invio (0-0,95).
   */
  async createDigitalTwin(
    name: string,
    file: File,
    consentConfirmed: boolean,
    onProgress?: (fraction: number) => void,
  ): Promise<CreateAvatarResult> {
    const contentType = file.type || (/\.mov$/i.test(file.name) ? 'video/quicktime' : /\.webm$/i.test(file.name) ? 'video/webm' : 'video/mp4');
    const base = `${this.baseUrl}/tenant/avatars/twin/uploads`;
    const up = await this.request<{ key: string; uploadId: string; partBytes: number; parts: number }>('/tenant/avatars/twin/uploads', {
      method: 'POST',
      body: JSON.stringify({ contentType, sizeBytes: file.size }),
    });
    const parts: Array<{ partNumber: number; etag: string }> = [];
    try {
      for (let n = 1; n <= up.parts; n++) {
        const chunk = file.slice((n - 1) * up.partBytes, Math.min(file.size, n * up.partBytes));
        const q = new URLSearchParams({ key: up.key, uploadId: up.uploadId, partNumber: String(n) });
        let last: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await this.sendXhr<{ etag: string }>('PUT', `${base}/part?${q.toString()}`, chunk, 'application/octet-stream', (f) =>
              onProgress?.((((n - 1 + f) * up.partBytes) / file.size) * 0.95),
            );
            parts.push({ partNumber: n, etag: r.etag });
            last = undefined;
            break;
          } catch (err) {
            last = err;
            await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
          }
        }
        if (last) throw last;
      }
    } catch (err) {
      void this.request('/tenant/avatars/twin/uploads/abort', { method: 'POST', body: JSON.stringify({ key: up.key, uploadId: up.uploadId }) }).catch(() => undefined);
      throw err;
    }
    onProgress?.(1);
    return this.request<CreateAvatarResult>('/tenant/avatars/twin/uploads/complete', {
      method: 'POST',
      body: JSON.stringify({ key: up.key, uploadId: up.uploadId, parts, name, consentConfirmed }),
    });
  }
  private async uploadAvatar(
    kind: 'photo' | 'twin',
    name: string,
    file: File,
    consentConfirmed: boolean,
    onProgress?: (fraction: number) => void,
  ) {
    const session = getSession();
    const form = new FormData();
    form.append('file', file);
    form.append('name', name);
    form.append('consentConfirmed', String(consentConfirmed));
    // XHR solo quando serve l'avanzamento dell'invio (fetch non lo espone).
    const send = (): Promise<{ status: number; body: string }> =>
      new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${this.baseUrl}/tenant/avatars/${kind}`);
        if (session) xhr.setRequestHeader('Authorization', `Bearer ${session.token}`);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
        };
        xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
        xhr.onerror = () => reject(new Error('Connessione interrotta durante l’invio del video'));
        xhr.ontimeout = () => reject(new Error('Invio del video troppo lento: riprova'));
        xhr.send(form);
      });
    const res = onProgress
      ? await send()
      : await (async () => {
          const headers = new Headers();
          if (session) headers.set('Authorization', `Bearer ${session.token}`);
          const r = await fetch(`${this.baseUrl}/tenant/avatars/${kind}`, { method: 'POST', headers, body: form });
          return { status: r.status, body: await r.text() };
        })();
    if (res.status === 401) void handleSessionExpired();
    if (res.status < 200 || res.status >= 300) {
      if (res.status === 402) notifyInsufficientCredits(res.body);
      throw new Error(`API ${res.status}: ${res.body.slice(0, 300)}`);
    }
    return JSON.parse(res.body) as CreateAvatarResult;
  }
  createPromptAvatar(name: string, prompt: string) {
    return this.request<CreateAvatarResult>('/tenant/avatars/prompt', {
      method: 'POST',
      body: JSON.stringify({ name, prompt }),
    });
  }
  getAvatarLook(lookId: string) {
    return this.request<AvatarLookStatus>(`/tenant/avatars/looks/${encodeURIComponent(lookId)}`);
  }
  async deleteAvatar(groupId: string) {
    await this.request<{ deleted: boolean }>(`/tenant/avatars/${encodeURIComponent(groupId)}`, { method: 'DELETE' });
  }

  // Immagini stock royalty-free
  searchStockImages(courseId: string, q: string) {
    return this.request<StockImageSearchResponse>(
      `/courses/${courseId}/stock-images/search?q=${encodeURIComponent(q)}`,
    );
  }
  attachStockImage(courseId: string, lessonId: string, input: AttachStockImageInput) {
    return this.request<{ attached: true; url: string }>(
      `/courses/${courseId}/stock-images/lessons/${lessonId}/attach`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }
  attachStockCover(courseId: string, input: AttachStockCoverInput) {
    return this.request<{ attached: true; url: string }>(
      `/courses/${courseId}/stock-images/cover`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }
  attachStockModuleCover(courseId: string, moduleId: string, input: AttachStockCoverInput) {
    return this.request<{ attached: true; url: string }>(
      `/courses/${courseId}/stock-images/modules/${moduleId}/cover`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }
  /** Carica un'immagine dal PC e la imposta come copertina del corso. */
  async uploadCover(courseId: string, file: File) {
    const session = getSession();
    const form = new FormData();
    form.append('file', file);
    const headers = new Headers();
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    const res = await fetch(`${this.baseUrl}/courses/${courseId}/stock-images/cover/upload`, {
      method: 'POST',
      headers,
      body: form,
    });
    if (res.status === 401) void handleSessionExpired();
    if (!res.ok) throw new Error(`Upload copertina fallito: ${res.status}`);
    return (await res.json()) as { attached: true; url: string };
  }
  /** Carica un'immagine dal PC e la imposta come copertina di un modulo. */
  async uploadModuleCover(courseId: string, moduleId: string, file: File) {
    const session = getSession();
    const form = new FormData();
    form.append('file', file);
    const headers = new Headers();
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    const res = await fetch(
      `${this.baseUrl}/courses/${courseId}/stock-images/modules/${moduleId}/cover/upload`,
      { method: 'POST', headers, body: form },
    );
    if (res.status === 401) void handleSessionExpired();
    if (!res.ok) throw new Error(`Upload copertina modulo fallito: ${res.status}`);
    return (await res.json()) as { attached: true; url: string };
  }
  redeemSso(ticket: string) {
    return this.request<SsoRedeemResult>('/sso/redeem', {
      method: 'POST',
      body: JSON.stringify({ ticket }),
    });
  }

  // Video-lezione da slide (PDF + avatar)
  async importSlides(courseId: string, file: File, language?: string) {
    const session = getSession();
    const form = new FormData();
    form.append('file', file);
    const headers = new Headers();
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    const res = await fetch(`${this.baseUrl}/courses/${courseId}/slides/import${language ? `?language=${encodeURIComponent(language)}` : ''}`, { method: 'POST', headers, body: form });
    if (res.status === 401) void handleSessionExpired();
    if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as SlideImportView;
  }
  createVideoImport(courseId: string, input: { title?: string; language?: string }) {
    return this.request<SlideImportView>(`/courses/${courseId}/slides/video-imports`, { method: 'POST', body: JSON.stringify(input) });
  }
  /**
   * Caricamento di un video con avanzamento. I file oltre 8 MB passano a pezzi da 8 MB (una
   * richiesta breve per pezzo, con nuovi tentativi), così nessuna richiesta rischia il limite di
   * tempo del server; alla fine si inviano copertina, fotogrammi e l'elenco dei pezzi.
   */
  async addImportVideo(
    courseId: string,
    importId: string,
    input: { file?: File; sourceId?: string; poster: Blob; frames: Blob[]; durationSec: number },
    onProgress?: (fraction: number) => void,
  ): Promise<SlideImportView> {
    const base = `${this.baseUrl}/courses/${courseId}/slides/imports/${importId}/videos`;
    const form = new FormData();
    form.append('poster', input.poster, 'poster.png');
    input.frames.forEach((f, i) => form.append('frames', f, `frame-${i + 1}.jpg`));
    form.append('durationSec', String(input.durationSec));
    // Nuovo spezzone di un video già caricato: solo copertina e fotogrammi.
    if (input.sourceId) {
      form.append('sourceId', input.sourceId);
      const view = await this.sendXhr<SlideImportView>('POST', base, form, undefined, onProgress);
      onProgress?.(1);
      return view;
    }
    const file = input.file;
    if (!file) throw new Error('Video mancante');
    const contentType = file.type || (/\.mov$/i.test(file.name) ? 'video/quicktime' : /\.webm$/i.test(file.name) ? 'video/webm' : 'video/mp4');
    const PART = 8 * 1024 * 1024;
    if (file.size <= PART) {
      form.append('file', new File([file], file.name, { type: contentType }));
      return this.sendXhr<SlideImportView>('POST', base, form, undefined, onProgress);
    }
    const up = await this.request<{ key: string; uploadId: string; partBytes: number; parts: number }>(`/courses/${courseId}/slides/imports/${importId}/videos/uploads`, {
      method: 'POST',
      body: JSON.stringify({ contentType, sizeBytes: file.size }),
    });
    const parts: Array<{ partNumber: number; etag: string }> = [];
    try {
      for (let n = 1; n <= up.parts; n++) {
        const chunk = file.slice((n - 1) * up.partBytes, Math.min(file.size, n * up.partBytes));
        const q = new URLSearchParams({ key: up.key, uploadId: up.uploadId, partNumber: String(n) });
        let last: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await this.sendXhr<{ etag: string }>('PUT', `${base}/uploads/part?${q.toString()}`, chunk, 'application/octet-stream', (f) =>
              onProgress?.(((n - 1 + f) * up.partBytes) / file.size * 0.98),
            );
            parts.push({ partNumber: n, etag: r.etag });
            last = undefined;
            break;
          } catch (err) {
            last = err;
            await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
          }
        }
        if (last) throw last;
      }
    } catch (err) {
      void this.request(`/courses/${courseId}/slides/imports/${importId}/videos/uploads/abort`, {
        method: 'POST',
        body: JSON.stringify({ key: up.key, uploadId: up.uploadId }),
      }).catch(() => undefined);
      throw err;
    }
    form.append('filename', file.name);
    form.append('contentType', contentType);
    form.append('uploadKey', up.key);
    form.append('uploadId', up.uploadId);
    form.append('parts', JSON.stringify(parts));
    const view = await this.sendXhr<SlideImportView>('POST', base, form);
    onProgress?.(1);
    return view;
  }

  /** Richiesta con avanzamento dell'invio (fetch non lo espone). */
  private sendXhr<T>(method: 'POST' | 'PUT', url: string, body: XMLHttpRequestBodyInit, contentType?: string, onProgress?: (f: number) => void): Promise<T> {
    const session = getSession();
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url);
      if (session) xhr.setRequestHeader('Authorization', `Bearer ${session.token}`);
      if (contentType) xhr.setRequestHeader('Content-Type', contentType);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status === 401) void handleSessionExpired();
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText || 'null') as T);
        else reject(new Error(`API ${xhr.status}: ${xhr.responseText.slice(0, 300)}`));
      };
      xhr.onerror = () => reject(new Error('Caricamento interrotto: controlla la connessione e riprova'));
      xhr.send(body);
    });
  }
  updateImportVideos(courseId: string, importId: string, input: import('@scorm/contracts').UpdateVideoImport) {
    return this.request<SlideImportView>(`/courses/${courseId}/slides/imports/${importId}/videos`, { method: 'PUT', body: JSON.stringify(input) });
  }
  // --- Podcast ---------------------------------------------------------------
  listPodcasts() {
    return this.request<PodcastListItem[]>('/podcasts');
  }
  getPodcast(id: string) {
    return this.request<PodcastView>(`/podcasts/${id}`);
  }
  createPodcast(input: CreatePodcast) {
    return this.request<PodcastView>('/podcasts', { method: 'POST', body: JSON.stringify(input) });
  }
  updatePodcast(id: string, input: UpdatePodcast) {
    return this.request<PodcastView>(`/podcasts/${id}`, { method: 'PUT', body: JSON.stringify(input) });
  }
  async deletePodcast(id: string) {
    await this.request<unknown>(`/podcasts/${id}`, { method: 'DELETE' });
  }
  estimateNewPodcast(minutes: number) {
    return this.request<PodcastEstimateView>(`/podcasts/estimate?minutes=${minutes}`);
  }
  estimatePodcast(id: string) {
    return this.request<PodcastEstimateView>(`/podcasts/${id}/estimate`);
  }
  listPodcastVoices(language: string) {
    return this.request<PodcastVoiceOption[]>(`/podcasts/voices?language=${encodeURIComponent(language)}`);
  }
  previewPodcastVoice(voiceId: string, provider: PodcastVoiceProvider, language: string) {
    return this.request<{ url: string }>('/podcasts/voices/preview', { method: 'POST', body: JSON.stringify({ voiceId, provider, language }) });
  }
  listPodcastFeedItems(url: string) {
    return this.request<{ feedTitle?: string; items: Array<{ title: string; link?: string; summary: string; isoDate?: string }> }>(
      `/podcasts/feed-items?url=${encodeURIComponent(url)}`,
    );
  }
  addPodcastEpisode(id: string, input: CreatePodcastEpisode) {
    return this.request<PodcastView>(`/podcasts/${id}/episodes`, { method: 'POST', body: JSON.stringify(input) });
  }
  suggestPodcastIdeas(id: string, input: SuggestPodcastIdeas) {
    return this.request<PodcastIdea[]>(`/podcasts/${id}/ideas`, { method: 'POST', body: JSON.stringify(input) });
  }
  updatePodcastEpisodes(id: string, input: UpdatePodcastEpisodes) {
    return this.request<PodcastView>(`/podcasts/${id}/episodes`, { method: 'PUT', body: JSON.stringify(input) });
  }
  writePodcastScripts(id: string, episodeIds?: string[]) {
    return this.request<PodcastView>(`/podcasts/${id}/scripts`, { method: 'POST', body: JSON.stringify({ episodeIds }) });
  }
  updatePodcastScript(id: string, episodeId: string, script: PodcastScript) {
    return this.request<PodcastView>(`/podcasts/${id}/episodes/${episodeId}/script`, { method: 'PUT', body: JSON.stringify(script) });
  }
  recordPodcastAudio(id: string, episodeIds?: string[]) {
    return this.request<PodcastView>(`/podcasts/${id}/audio`, { method: 'POST', body: JSON.stringify({ episodeIds }) });
  }
  async cancelPodcastWork(id: string) {
    await this.request<unknown>(`/podcasts/${id}/cancel`, { method: 'POST' });
  }
  getPodcastAudioUrl(id: string, episodeId: string) {
    return this.request<{ url: string; downloadUrl: string }>(`/podcasts/${id}/episodes/${episodeId}/audio`);
  }
  getPodcastTranscript(id: string, episodeId: string, format: 'txt' | 'srt' | 'vtt') {
    return this.request<{ filename: string; contentType: string; body: string }>(`/podcasts/${id}/episodes/${episodeId}/transcript?format=${format}`);
  }
  publishPodcastEpisode(id: string, episodeId: string) {
    return this.request<PodcastView>(`/podcasts/${id}/episodes/${episodeId}/publish`, { method: 'POST' });
  }
  unpublishPodcastEpisode(id: string, episodeId: string) {
    return this.request<PodcastView>(`/podcasts/${id}/episodes/${episodeId}/publish`, { method: 'DELETE' });
  }
  setPodcastFeed(id: string, visibility: PodcastFeedVisibility) {
    return this.request<PodcastView>(`/podcasts/${id}/feed`, { method: 'PUT', body: JSON.stringify({ visibility }) });
  }
  rotatePodcastFeedToken(id: string) {
    return this.request<PodcastView>(`/podcasts/${id}/feed/rotate-token`, { method: 'POST' });
  }
  async uploadPodcastCover(id: string, file: File) {
    const session = getSession();
    const form = new FormData();
    form.append('file', file);
    const headers = new Headers();
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    const res = await fetch(`${this.baseUrl}/podcasts/${id}/cover`, { method: 'POST', headers, body: form });
    if (res.status === 401) void handleSessionExpired();
    if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as PodcastView;
  }
  fitSlideScript(courseId: string, importId: string, index: number) {
    return this.request<SlideScriptsDoc>(`/courses/${courseId}/slides/imports/${importId}/scripts/${index}/fit`, { method: 'POST' });
  }
  getVideoTiming(courseId: string, importId: string) {
    return this.request<VideoTiming[]>(`/courses/${courseId}/slides/imports/${importId}/timing`);
  }
  getSlideImport(courseId: string, importId: string) {
    return this.request<SlideImportView>(`/courses/${courseId}/slides/imports/${importId}`);
  }
  getSlideScripts(courseId: string, importId: string) {
    return this.request<SlideScriptsResponse>(`/courses/${courseId}/slides/imports/${importId}/scripts`);
  }
  generateSlideScripts(courseId: string, importId: string, knowledgeDocIds?: string[]) {
    return this.request<SlideScriptsGeneration>(`/courses/${courseId}/slides/imports/${importId}/scripts/generate`, {
      method: 'POST',
      body: JSON.stringify({ knowledgeDocIds: knowledgeDocIds ?? [] }),
    });
  }
  saveSlideScripts(
    courseId: string,
    importId: string,
    input: { slides: Array<{ index: number; script: string; skip: boolean }>; approved: boolean },
  ) {
    return this.request<SlideScriptsDoc>(`/courses/${courseId}/slides/imports/${importId}/scripts`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }
  setSlideGlossary(courseId: string, importId: string, glossary: PronunciationEntry[]) {
    return this.request<SlideScriptsDoc>(`/courses/${courseId}/slides/imports/${importId}/glossary`, {
      method: 'PUT',
      body: JSON.stringify({ glossary }),
    });
  }
  changeSlideAvatar(courseId: string, importId: string, input: StartSlideClipsInput) {
    return this.request<SlideClipsView>(`/courses/${courseId}/slides/imports/${importId}/clips/avatar`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  estimateSlideClips(courseId: string, importId: string, engine: string | undefined, avatarType: SlideAvatarType, all?: boolean) {
    const qs = new URLSearchParams({ avatarType });
    if (all) qs.set('all', 'true');
    if (engine) qs.set('engine', engine);
    return this.request<SlideClipsEstimate>(`/courses/${courseId}/slides/imports/${importId}/clips/estimate?${qs.toString()}`);
  }
  getSlideClips(courseId: string, importId: string) {
    return this.request<SlideClipsView | { status: 'none' }>(`/courses/${courseId}/slides/imports/${importId}/clips`);
  }
  startSlideClips(courseId: string, importId: string, input: StartSlideClipsInput) {
    return this.request<SlideClipsView>(`/courses/${courseId}/slides/imports/${importId}/clips`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  getSlideChanges(courseId: string, importId: string) {
    return this.request<SlideChangesView>(`/courses/${courseId}/slides/imports/${importId}/changes`);
  }
  applySlideChanges(courseId: string, importId: string) {
    return this.request<SlideChangesView>(`/courses/${courseId}/slides/imports/${importId}/changes/apply`, { method: 'POST' });
  }
  getSlideLesson(courseId: string, importId: string) {
    return this.request<SlideLessonView | { status: 'none' }>(`/courses/${courseId}/slides/imports/${importId}/lesson`);
  }
  async replaceSlides(courseId: string, importId: string, file: File) {
    const session = getSession();
    const form = new FormData();
    form.append('file', file);
    const headers = new Headers();
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    const res = await fetch(`${this.baseUrl}/courses/${courseId}/slides/imports/${importId}/replace`, { method: 'POST', headers, body: form });
    if (res.status === 401) void handleSessionExpired();
    if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 2000)}`);
    return (await res.json()) as SlideImportView & { warnings: string[] };
  }
  remasterSlideLesson(courseId: string, importId: string, input?: SlideLayoutChoice) {
    return this.request<SlideLessonView>(`/courses/${courseId}/slides/imports/${importId}/lesson/remaster`, {
      method: 'POST',
      body: JSON.stringify(input ?? {}),
    });
  }
  proposeSlideSections(courseId: string, importId: string) {
    return this.request<{ sections: SlideSection[] }>(`/courses/${courseId}/slides/imports/${importId}/sections/propose`, { method: 'POST' });
  }
  getSlideDirection(courseId: string, importId: string) {
    return this.request<{ items: SlideDirectionItem[] }>(`/courses/${courseId}/slides/imports/${importId}/lesson/direction`);
  }
  buildSlideLesson(courseId: string, importId: string, input: SlideLayoutChoice & { layout: SlideLayout; moduleTitle?: string; sections?: SlideSection[] }) {
    return this.request<SlideLessonView>(`/courses/${courseId}/slides/imports/${importId}/lesson`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
}
