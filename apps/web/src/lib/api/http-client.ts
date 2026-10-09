import type { Block, Brief, BriefDraft } from '@scorm/contracts';
import { getSession } from '../auth';
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
} from './types';

/**
 * Client HTTP reale verso apps/api. Allega il Bearer token della sessione dev e
 * un correlation id. Si attiva con NEXT_PUBLIC_API_MODE=real.
 */
export class HttpApiClient implements ApiClient {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const session = getSession();
    const headers = new Headers(init?.headers);
    headers.set('Content-Type', 'application/json');
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    headers.set('x-correlation-id', crypto.randomUUID());

    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!res.ok) {
      const body = await res.text();
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
  async deleteCourse(id: string) { await this.request(`/courses/${id}`, { method: 'DELETE' }); }
  saveBrief(courseId: string, brief: Brief) {
    return this.request<CourseView>(`/courses/${courseId}/brief`, { method: 'PUT', body: JSON.stringify(brief) });
  }
  saveBriefDraft(courseId: string, draft: BriefDraft) {
    return this.request<CourseView>(`/courses/${courseId}/brief/draft`, { method: 'PUT', body: JSON.stringify(draft) });
  }
  updateCourseSettings(courseId: string, settings: { interactionStyle?: 'sober' | 'lively'; navPosition?: 'side' | 'top'; primaryBrandId?: string; instructor?: { name?: string; role?: string; avatarKey?: string } }) {
    return this.request<CourseView>(`/courses/${courseId}/settings`, { method: 'PUT', body: JSON.stringify(settings) });
  }
  async uploadInstructorAvatar(courseId: string, file: File) {
    const session = getSession();
    const form = new FormData();
    form.append('file', file);
    const headers = new Headers();
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    const res = await fetch(`${this.baseUrl}/courses/${courseId}/instructor/avatar`, { method: 'POST', headers, body: form });
    if (!res.ok) throw new Error(`Upload foto fallito: ${res.status}`);
    return (await res.json()) as { avatarKey: string; avatarUrl: string };
  }
  listModules(courseId: string) { return this.request<ModuleView[]>(`/courses/${courseId}/modules`); }
  listAssessments(courseId: string) { return this.request<AssessmentIndexView[]>(`/courses/${courseId}/assessments`); }
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
    if (!res.ok) throw new Error(`Upload video fallito: ${res.status}`);
    return (await res.json()) as { storageKey: string; url: string };
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
  generateLessonNarration(courseId: string, lessonId: string) {
    return this.request<{ url: string; bytes: number; voice: string }>(
      `/courses/${courseId}/generate/lessons/${lessonId}/narration`,
      { method: 'POST' },
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
    if (!res.ok) throw new Error(`Upload fallito: ${res.status}`);
    return (await res.json()) as KnowledgeDocView;
  }
  async deleteKnowledge(id: string) { await this.request(`/knowledge/${id}`, { method: 'DELETE' }); }
  listBrands() { return this.request<BrandView[]>('/brands'); }
  getBrand(id: string) { return this.request<BrandView>(`/brands/${id}`); }
  createBrand(def: Omit<BrandView, 'id' | 'tenantId'>) {
    return this.request<BrandView>('/brands', { method: 'POST', body: JSON.stringify(def) });
  }
  updateBrand(id: string, def: Omit<BrandView, 'id' | 'tenantId'>) {
    return this.request<BrandView>(`/brands/${id}`, { method: 'PUT', body: JSON.stringify(def) });
  }
  async deleteBrand(id: string) { await this.request(`/brands/${id}`, { method: 'DELETE' }); }
  exportCourse(courseId: string, brandId: string, profile: ScormProfile, allowUnapproved?: boolean, includeSemanticSearch?: boolean) {
    return this.request<ExportResultView>(`/courses/${courseId}/export`, {
      method: 'POST',
      body: JSON.stringify({ brandId, profile, allowUnapproved, includeSemanticSearch }),
    });
  }
  getUsage() { return this.request<UsageView>('/usage'); }
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
  listFolders() { return this.request<FolderView[]>('/folders'); }
  createFolder(input: CreateFolder) {
    return this.request<FolderView>('/folders', { method: 'POST', body: JSON.stringify(input) });
  }
  updateFolder(id: string, input: UpdateFolder) {
    return this.request<FolderView>(`/folders/${id}`, { method: 'PUT', body: JSON.stringify(input) });
  }
  async deleteFolder(id: string) { await this.request(`/folders/${id}`, { method: 'DELETE' }); }
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
  async uploadBrandingAsset(kind: 'logo' | 'favicon', file: File) {
    const session = getSession();
    const form = new FormData();
    form.append('file', file);
    const headers = new Headers();
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    const res = await fetch(`${this.baseUrl}/tenant/branding/${kind}`, { method: 'POST', headers, body: form });
    if (!res.ok) throw new Error(`Upload ${kind} fallito: ${res.status}`);
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
    if (!res.ok) throw new Error(`Upload video fallito: ${res.status}`);
    return (await res.json()) as VideoAssetView;
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
}
