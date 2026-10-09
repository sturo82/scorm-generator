import type { Block, Brief, BriefDraft } from '@scorm/contracts';
import { computeQuote } from '@scorm/contracts';
import type {
  AdminUserView,
  ApiClient,
  AppUserRole,
  AuditEventView,
  BrandView,
  CourseCostSummary,
  CourseOutlineView,
  CourseQuoteView,
  CourseView,
  CreateFolder,
  EditorialStatus,
  ExportResultView,
  FolderView,
  JobRef,
  JobView,
  KnowledgeDocView,
  KnowledgeScope,
  LessonView,
  ModuleView,
  PricingQuoteInput,
  QuotaStatus,
  ScormProfile,
  UpdateFolder,
  UsageView,
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

/** Ritardo simulato per rendere realistici gli stati di loading nella UI. */
const delay = (ms = 350): Promise<void> => new Promise((r) => setTimeout(r, ms));
const id = (p: string): string => `${p}_${Math.random().toString(36).slice(2, 9)}`;

function richBlock(html: string): Block {
  return {
    id: id('blk'),
    type: 'rich_text',
    editorial: { status: 'draft', citations: [] },
    payload: { content: { format: 'html', html }, media: [] },
  };
}

/**
 * Implementazione mock in-memory dell'ApiClient. Permette di usare l'intera UI
 * senza backend (dev/demo). I dati vivono in memoria per la sessione del tab.
 */
export class MockApiClient implements ApiClient {
  /** Job di generazione simulati (async): id -> stato. */
  private jobs = new Map<string, JobView>();

  /**
   * Crea un job QUEUED e, dopo un breve ritardo, esegue l'effetto e lo porta a
   * COMPLETED (o FAILED). Ritorna subito { jobId }, emulando l'API async reale.
   */
  private startJob(courseId: string, type: string, effect: () => void): JobRef {
    const jobId = id('job');
    const now = new Date().toISOString();
    this.jobs.set(jobId, { id: jobId, type, status: 'QUEUED', createdAt: now });
    setTimeout(() => {
      this.jobs.set(jobId, { ...this.jobs.get(jobId)!, status: 'RUNNING' });
      setTimeout(() => {
        try {
          effect();
          this.jobs.set(jobId, {
            ...this.jobs.get(jobId)!,
            status: 'COMPLETED',
            finishedAt: new Date().toISOString(),
          });
        } catch (e) {
          this.jobs.set(jobId, {
            ...this.jobs.get(jobId)!,
            status: 'FAILED',
            error: e instanceof Error ? e.message : 'Errore',
            finishedAt: new Date().toISOString(),
          });
        }
      }, 700);
    }, 150);
    return { jobId };
  }

  async getJob(_courseId: string, jobId: string): Promise<JobView> {
    await delay(120);
    const job = this.jobs.get(jobId);
    if (!job) throw new Error('Job non trovato');
    return job;
  }

  async listActiveJobs(_courseId: string): Promise<JobView[]> {
    await delay(120);
    return Array.from(this.jobs.values()).filter(
      (j) => j.status === 'QUEUED' || j.status === 'RUNNING',
    );
  }

  private courses: CourseView[] = [
    {
      id: 'crs_demo',
      title: 'Sicurezza sul lavoro',
      description: 'Corso introduttivo sulla sicurezza per neoassunti.',
      language: 'it',
      status: 'DRAFT',
      brief: {
        title: 'Sicurezza sul lavoro',
        learningObjectives: ['Riconoscere i rischi', 'Usare i DPI'],
        targetAudience: 'Neoassunti',
        level: 'beginner',
        estimatedDurationMinutes: 90,
        language: 'it',
        requestedAssessments: ['final'],
        constraints: [],
        brandIds: ['brand_acme'],
      },
    },
  ];

  private modules: Record<string, ModuleView[]> = {
    crs_demo: [
      {
        id: 'mod_1',
        title: 'Introduzione alla sicurezza',
        position: 0,
        status: 'DRAFT',
        lessons: [
          {
            id: 'les_1',
            title: 'Perché la sicurezza conta',
            position: 0,
            status: 'DRAFT',
            objectives: ['Comprendere l\'importanza della sicurezza'],
            blocks: [richBlock('<p>La sicurezza sul lavoro protegge le persone e l\'azienda.</p>')],
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    ],
  };

  private knowledge: KnowledgeDocView[] = [
    { id: 'doc_1', filename: 'manuale-sicurezza.pdf', mimeType: 'application/pdf', sizeBytes: 1_240_000, scope: 'GLOBAL', courseId: null, status: 'READY' },
  ];

  private brands: BrandView[] = [
    {
      id: 'brand_acme',
      tenantId: 'tenant-dev',
      name: 'Acme',
      assets: { logoPrimaryUrl: 'https://cdn.example/acme.svg' },
      colors: { primary: '#4F46E5', onPrimary: '#FFFFFF', surface: '#FFFFFF', onSurface: '#111827', success: '#16A34A', warning: '#D97706', error: '#DC2626' },
      typography: { fontFamilyHeading: 'Inter', fontFamilyBody: 'Inter' },
      voice: { tone: 'professionale e rassicurante' },
    },
    {
      id: 'brand_globex',
      tenantId: 'tenant-dev',
      name: 'Globex',
      assets: { logoPrimaryUrl: 'https://cdn.example/globex.svg' },
      colors: { primary: '#DC2626', onPrimary: '#FFFFFF', surface: '#FFFFFF', onSurface: '#111827', success: '#16A34A', warning: '#D97706', error: '#B91C1C' },
      typography: { fontFamilyHeading: 'Inter', fontFamilyBody: 'Inter' },
    },
  ];

  private audit: AuditEventView[] = [];
  private folders: FolderView[] = [];

  async listCourses(filter?: { folderId?: string | 'root'; q?: string }) {
    await delay();
    const q = filter?.q?.trim().toLowerCase();
    if (q) {
      return this.courses.filter(
        (c) => c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
      );
    }
    if (filter?.folderId !== undefined) {
      const target = filter.folderId === 'root' ? null : filter.folderId;
      return this.courses.filter((c) => (c.folderId ?? null) === target);
    }
    return [...this.courses];
  }
  async getCourse(id: string) {
    await delay();
    const c = this.courses.find((x) => x.id === id);
    if (!c) throw new Error('Corso non trovato');
    return c;
  }
  async createCourse(input: { title: string; description?: string; language: string }) {
    await delay();
    const course: CourseView = {
      id: id('crs'),
      title: input.title,
      description: input.description ?? '',
      language: input.language,
      status: 'DRAFT',
      brief: null,
      interactionStyle: 'sober',
    };
    this.courses.unshift(course);
    this.modules[course.id] = [];
    this.pushAudit('course.create', 'course', course.id);
    return course;
  }
  async deleteCourse(id: string) {
    await delay();
    this.courses = this.courses.filter((c) => c.id !== id);
    this.pushAudit('course.delete', 'course', id);
  }
  async saveBrief(courseId: string, brief: Brief) {
    await delay();
    const c = await this.getCourse(courseId);
    c.brief = brief;
    c.title = brief.title;
    c.language = brief.language;
    return c;
  }
  async saveBriefDraft(courseId: string, draft: BriefDraft) {
    await delay();
    const c = await this.getCourse(courseId);
    c.brief = { ...(c.brief ?? {}), ...draft };
    return c;
  }
  async updateCourseSettings(courseId: string, settings: { interactionStyle?: 'sober' | 'lively'; primaryBrandId?: string; instructor?: { name?: string; role?: string; avatarKey?: string } }) {
    await delay();
    const c = await this.getCourse(courseId);
    if (settings.interactionStyle) c.interactionStyle = settings.interactionStyle;
    if (settings.primaryBrandId !== undefined) c.primaryBrandId = settings.primaryBrandId;
    if (settings.instructor !== undefined) {
      const name = settings.instructor?.name?.trim();
      c.instructor = name
        ? { name, role: settings.instructor?.role?.trim() || undefined, avatarUrl: c.instructor?.avatarUrl }
        : undefined;
    }
    this.pushAudit('course.update_settings', 'course', courseId);
    return c;
  }
  async uploadInstructorAvatar(courseId: string, _file: File) {
    await delay(400);
    const c = await this.getCourse(courseId);
    const url = 'https://placehold.co/160x160?text=Docente';
    if (c.instructor) c.instructor.avatarUrl = url;
    return { avatarKey: `mock/instructor/${courseId}.png`, avatarUrl: url };
  }
  async listModules(courseId: string) {
    await delay();
    return this.modules[courseId] ?? [];
  }
  async listAssessments(_courseId: string) {
    await delay();
    return [];
  }
  async addModule(courseId: string, input: { title: string; summary?: string }) {
    await delay();
    const list = (this.modules[courseId] ??= []);
    const m: ModuleView = { id: id('mod'), title: input.title, summary: input.summary, position: list.length, status: 'DRAFT', lessons: [] };
    list.push(m);
    return m;
  }
  async addLesson(courseId: string, moduleId: string, input: { title: string }) {
    await delay();
    const mod = (this.modules[courseId] ?? []).find((m) => m.id === moduleId);
    if (!mod) throw new Error('Modulo non trovato');
    const l: LessonView = { id: id('les'), title: input.title, position: mod.lessons.length, status: 'DRAFT', objectives: [], blocks: [], updatedAt: new Date().toISOString() };
    mod.lessons.push(l);
    return l;
  }
  async deleteModule(courseId: string, moduleId: string) {
    await delay();
    const list = this.modules[courseId] ?? [];
    this.modules[courseId] = list.filter((m) => m.id !== moduleId).map((m, i) => ({ ...m, position: i }));
    this.pushAudit('module.delete', 'module', moduleId);
  }
  async deleteLesson(courseId: string, moduleId: string, lessonId: string) {
    await delay();
    const mod = (this.modules[courseId] ?? []).find((m) => m.id === moduleId);
    if (!mod) throw new Error('Modulo non trovato');
    mod.lessons = mod.lessons.filter((l) => l.id !== lessonId).map((l, i) => ({ ...l, position: i }));
    this.pushAudit('lesson.delete', 'lesson', lessonId);
  }
  async applyOutline(courseId: string) {
    // La materializzazione ora avviene automaticamente nel job dell'outline.
    // Questo metodo resta per compatibilità e ritorna la struttura corrente.
    await delay(300);
    this.pushAudit('course.outline.apply', 'course', courseId);
    return this.modules[courseId] ?? [];
  }
  /**
   * Async: accoda la generazione dell'outline. Al completamento costruisce
   * l'outline E materializza subito la struttura (come il backend), così lo
   * step struttura mostra moduli/lezioni senza passaggi manuali.
   */
  async generateOutline(courseId: string): Promise<JobRef> {
    await delay(150);
    const outline: CourseOutlineView = {
      title: '',
      description: '',
      language: 'it',
      modules: [
        { title: 'Introduzione', lessons: [{ title: 'Concetti base', objectives: ['Capire i fondamenti'], suggestedBlockTypes: ['rich_text', 'flashcard'] }], hasIntermediateAssessment: false },
        { title: 'Approfondimento', lessons: [{ title: 'Casi pratici', objectives: ['Applicare in scenari reali'], suggestedBlockTypes: ['branching_scenario', 'dragdrop_match'] }], hasIntermediateAssessment: true },
      ],
      hasFinalAssessment: true,
    };
    const ref = this.startJob(courseId, 'course.generate_outline', () => {
      const list = this.modules[courseId] ?? (this.modules[courseId] = []);
      const byTitle = new Map(list.map((m) => [m.title, m]));
      for (const mo of outline.modules) {
        let mod = byTitle.get(mo.title);
        if (!mod) {
          mod = { id: id('mod'), title: mo.title, summary: mo.summary, position: list.length, status: 'DRAFT', lessons: [] };
          list.push(mod);
          byTitle.set(mo.title, mod);
        }
        const lessonTitles = new Set(mod.lessons.map((l) => l.title));
        for (const lo of mo.lessons) {
          if (lessonTitles.has(lo.title)) continue;
          mod.lessons.push({ id: id('les'), title: lo.title, position: mod.lessons.length, status: 'DRAFT', objectives: lo.objectives, blocks: [], updatedAt: new Date().toISOString() });
        }
      }
    });
    this.pushAudit('course.generate_outline', 'course', courseId);
    return ref;
  }
  /** Async: accoda la generazione dei contenuti di una lezione. */
  async generateLessonContent(courseId: string, lessonId: string, toneInstruction?: string): Promise<JobRef> {
    await delay(150);
    const ref = this.startJob(courseId, 'course.generate_content', () => {
      const blocks: Block[] = [
        richBlock(`<p>Contenuto generato${toneInstruction ? ` (${toneInstruction})` : ''}.</p>`),
        {
          id: id('blk'),
          type: 'flashcard',
          editorial: { status: 'draft', citations: [] },
          payload: { cards: [{ id: id('c'), front: { format: 'html', html: '<p>Domanda?</p>' }, back: { format: 'html', html: '<p>Risposta.</p>' } }] },
        },
      ];
      const lesson = this.findLesson(courseId, lessonId);
      lesson.blocks = blocks;
      lesson.updatedAt = new Date().toISOString();
    });
    this.pushAudit('course.generate_content', 'lesson', lessonId);
    return ref;
  }
  async generateAllContent(courseId: string): Promise<JobRef> {
    await delay(150);
    const ref = this.startJob(courseId, 'course.generate_all_content', () => {
      for (const m of this.modules[courseId] ?? []) {
        for (const l of m.lessons) {
          if (l.blocks.length === 0) {
            l.blocks = [richBlock('<p>Contenuto generato (batch).</p>')];
            l.updatedAt = new Date().toISOString();
          }
        }
      }
    });
    this.pushAudit('course.generate_all_content', 'course', courseId);
    return ref;
  }
  async listActiveCourseIds() {
    await delay(100);
    // Mock: nessun job attivo persistente (i job mock completano subito).
    return [] as Array<{ courseId: string; jobs: number }>;
  }
  async uploadLessonVideo(courseId: string, lessonId: string, _blockId: string, _file: File) {
    await delay(400);
    this.pushAudit('course.upload_video', 'lesson', lessonId);
    return { storageKey: `media/mock/${courseId}/video/mock.mp4`, url: '#mock-video' };
  }
  async generateLessonImages(courseId: string, lessonId: string) {
    await delay(600);
    this.pushAudit('course.generate_images', 'lesson', lessonId);
    return { generated: 1, skipped: 0, failed: 0, warnings: [] };
  }
  async generateLessonNarration(courseId: string, lessonId: string) {
    await delay(600);
    const lesson = this.findLesson(courseId, lessonId);
    lesson.narrationUrl = '#mock-audio';
    this.pushAudit('course.generate_narration', 'lesson', lessonId);
    return { url: '#mock-audio', bytes: 12345, voice: 'Bianca' };
  }
  async generateCover(courseId: string) {
    await delay(600);
    const c = this.courses.find((x) => x.id === courseId);
    const url = 'https://placehold.co/1280x720?text=Cover';
    if (c) c.coverImageUrl = url;
    this.pushAudit('course.generate_cover', 'course', courseId);
    return { url };
  }
  async generateModuleCover(_courseId: string, _moduleId: string) {
    await delay(600);
    const url = 'https://placehold.co/1280x720?text=Module+Cover';
    return { url };
  }
  async editLessonBlocks(courseId: string, lessonId: string, blocks: Block[], _expectedUpdatedAt: string) {
    await delay();
    const l = this.findLesson(courseId, lessonId);
    l.blocks = blocks;
    l.updatedAt = new Date().toISOString();
    return l;
  }
  async setStatus(courseId: string, entity: 'course' | 'module' | 'lesson' | 'assessment', entityId: string, status: EditorialStatus) {
    await delay(200);
    if (entity === 'course') {
      const c = this.courses.find((x) => x.id === entityId);
      if (c) c.status = status;
    } else if (entity === 'module') {
      const m = (this.modules[courseId] ?? []).find((x) => x.id === entityId);
      if (m) m.status = status;
    } else if (entity === 'lesson') {
      for (const m of this.modules[courseId] ?? []) {
        const l = m.lessons.find((x) => x.id === entityId);
        if (l) l.status = status;
      }
    }
    this.pushAudit(`${entity}.status.${status}`, entity, entityId);
  }
  async setLessonVideoFirst(courseId: string, _moduleId: string, lessonId: string, videoFirst: boolean) {
    await delay(150);
    for (const m of this.modules[courseId] ?? []) {
      const l = m.lessons.find((x) => x.id === lessonId);
      if (l) (l as { videoFirst?: boolean }).videoFirst = videoFirst;
    }
  }
  async getRagChunks(_courseId: string) {
    await delay(120);
    return [
      { text: 'Esempio di passaggio dalla knowledge del corso (mock).', documentName: 'manuale-sicurezza.pdf', section: 'Introduzione' },
    ];
  }
  async getRagEmbeddings(courseId: string) {
    await delay(120);
    const chunks = await this.getRagChunks(courseId);
    // Mock: nessun embedding → l'anteprima userà la ricerca lessicale.
    return { chunks, model: 'Xenova/all-MiniLM-L6-v2', dim: 384, count: chunks.length, embeddingsB64: null };
  }
  async listKnowledge(scope?: KnowledgeScope, courseId?: string) {
    await delay();
    return this.knowledge.filter((d) => (!scope || d.scope === scope) && (!courseId || d.courseId === courseId));
  }
  async uploadKnowledge(file: File, scope: KnowledgeScope, courseId?: string) {
    await delay(700);
    const doc: KnowledgeDocView = { id: id('doc'), filename: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size, scope, courseId: courseId ?? null, status: 'PROCESSING' };
    this.knowledge.unshift(doc);
    // Simula il completamento dell'ingestion.
    setTimeout(() => { doc.status = 'READY'; }, 1500);
    this.pushAudit('knowledge.upload', 'knowledge', doc.id);
    return doc;
  }
  async deleteKnowledge(docId: string) {
    await delay();
    this.knowledge = this.knowledge.filter((d) => d.id !== docId);
  }
  async listBrands() {
    await delay();
    return [...this.brands];
  }
  async getBrand(brandId: string) {
    await delay();
    const b = this.brands.find((x) => x.id === brandId);
    if (!b) throw new Error('Brand non trovato');
    return b;
  }
  async createBrand(def: Omit<BrandView, 'id' | 'tenantId'>) {
    await delay();
    const b: BrandView = { ...def, id: id('brand'), tenantId: 'tenant-dev' };
    this.brands.unshift(b);
    this.pushAudit('brand.create', 'brand', b.id);
    return b;
  }
  async updateBrand(brandId: string, def: Omit<BrandView, 'id' | 'tenantId'>) {
    await delay();
    const idx = this.brands.findIndex((x) => x.id === brandId);
    if (idx === -1) throw new Error('Brand non trovato');
    this.brands[idx] = { ...def, id: brandId, tenantId: 'tenant-dev' };
    return this.brands[idx]!;
  }
  async deleteBrand(brandId: string) {
    await delay();
    this.brands = this.brands.filter((b) => b.id !== brandId);
  }
  async exportCourse(courseId: string, brandId: string, profile: ScormProfile, _allowUnapproved?: boolean, _includeSemanticSearch?: boolean): Promise<ExportResultView> {
    await delay(1200);
    this.pushAudit('course.export', 'course', courseId);
    return {
      packageId: id('pkg'),
      version: 1,
      downloadUrl: `#mock-download/${courseId}/${brandId}/${profile}`,
      sizeBytes: 12_340,
      warnings: [],
    };
  }
  async getUsage(): Promise<UsageView> {
    await delay();
    const quotas: QuotaStatus[] = [
      { resource: 'courses', limit: 25, current: this.courses.length, remaining: 25 - this.courses.length },
      { resource: 'brands', limit: 3, current: this.brands.length, remaining: Math.max(0, 3 - this.brands.length) },
      { resource: 'knowledgeMb', limit: 500, current: 12, remaining: 488 },
      { resource: 'exportsPerMonth', limit: 100, current: 4, remaining: 96 },
      { resource: 'users', limit: 10, current: 3, remaining: 7 },
    ];
    return { featureFlags: { scorm12Export: true, advancedInteractions: true, dataDeletion: false, sso: false }, quotas };
  }
  async listAudit() {
    await delay();
    return [...this.audit].reverse();
  }
  async getCourseCost(courseId: string): Promise<CourseCostSummary> {
    await delay();
    // Mock plausibile: un corso con outline + 4 lezioni illustrate + narrazione.
    return {
      courseId,
      providerCostUsd: 0.2156,
      lines: [
        { source: 'lesson_content', provider: 'BEDROCK_LLM', unit: 'OUTPUT_TOKENS', quantity: 9800, calls: 4, costUsd: 0.147 },
        { source: 'image', provider: 'BEDROCK_IMAGE', unit: 'IMAGES', quantity: 8, calls: 8, costUsd: 0.32 },
        { source: 'outline', provider: 'BEDROCK_LLM', unit: 'INPUT_TOKENS', quantity: 6200, calls: 1, costUsd: 0.0186 },
        { source: 'narration', provider: 'POLLY', unit: 'CHARACTERS', quantity: 4200, calls: 4, costUsd: 0.0672 },
      ],
      totalCalls: 17,
      lastUsageAt: new Date().toISOString(),
    };
  }
  async getCourseQuote(courseId: string, input: PricingQuoteInput): Promise<CourseQuoteView> {
    await delay();
    const summary = await this.getCourseCost(courseId);
    const quote = computeQuote(summary.providerCostUsd, input);
    return { ...quote, summary };
  }
  async listFolders(): Promise<FolderView[]> {
    await delay();
    return this.folders.map((f) => ({
      ...f,
      courseCount: this.courses.filter((c) => (c.folderId ?? null) === f.id).length,
    }));
  }
  async createFolder(input: CreateFolder): Promise<FolderView> {
    await delay();
    const folder: FolderView = {
      id: id('fld'),
      name: input.name,
      parentId: input.parentId ?? null,
      position: this.folders.filter((f) => f.parentId === (input.parentId ?? null)).length,
      courseCount: 0,
    };
    this.folders.push(folder);
    return folder;
  }
  async updateFolder(folderId: string, input: UpdateFolder): Promise<FolderView> {
    await delay();
    const f = this.folders.find((x) => x.id === folderId);
    if (!f) throw new Error('Cartella non trovata');
    if (input.name !== undefined) f.name = input.name;
    if (input.parentId !== undefined) f.parentId = input.parentId;
    return { ...f, courseCount: this.courses.filter((c) => (c.folderId ?? null) === f.id).length };
  }
  async deleteFolder(folderId: string): Promise<void> {
    await delay();
    this.folders = this.folders.filter((f) => f.id !== folderId);
    // I corsi tornano in radice; le sottocartelle risalgono.
    for (const c of this.courses) if (c.folderId === folderId) c.folderId = null;
    for (const f of this.folders) if (f.parentId === folderId) f.parentId = null;
  }
  async moveCourse(courseId: string, folderId: string | null): Promise<void> {
    await delay();
    const c = this.courses.find((x) => x.id === courseId);
    if (!c) throw new Error('Corso non trovato');
    c.folderId = folderId;
  }

  /** Branding white-label in-memory (default + patch dell'utente). */
  private branding: AppBrandingView = {
    appName: 'SCORM Generator',
    primaryColor: '#4f46e5',
    accentColor: null,
    headerColor: null,
    logoKey: null,
    faviconKey: null,
    logoUrl: null,
    faviconUrl: null,
  };
  /** Utenti in-memory per il pannello admin (demo). */
  private users: AdminUserView[] = [
    { id: 'u-owner', email: 'owner@demo.test', displayName: 'Dev Owner', role: 'OWNER', createdAt: new Date().toISOString() },
  ];
  async listUsers(): Promise<AdminUserView[]> {
    await delay(120);
    return [...this.users];
  }
  async createUser(input: { email: string; displayName?: string; role: AppUserRole }): Promise<AdminUserView> {
    await delay();
    if (this.users.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) {
      throw new Error('Esiste già un utente con questa email');
    }
    const u: AdminUserView = {
      id: id('user'),
      email: input.email,
      displayName: input.displayName ?? null,
      role: input.role,
      createdAt: new Date().toISOString(),
    };
    this.users.push(u);
    return u;
  }
  async getBranding(): Promise<AppBrandingView> {
    await delay(120);
    return { ...this.branding };
  }
  async updateBranding(patch: UpdateAppBranding): Promise<AppBrandingView> {
    await delay();
    this.branding = { ...this.branding, ...patch };
    return { ...this.branding };
  }
  async uploadBrandingAsset(kind: 'logo' | 'favicon', file: File): Promise<AppBrandingView> {
    await delay();
    const url = URL.createObjectURL(file);
    if (kind === 'logo') this.branding = { ...this.branding, logoKey: `mock/logo`, logoUrl: url };
    else this.branding = { ...this.branding, faviconKey: `mock/favicon`, faviconUrl: url };
    return { ...this.branding };
  }

  /** Libreria video in-memory. */
  private videos: VideoAssetView[] = [];
  async listVideos(filter?: { source?: string; channel?: string }): Promise<VideoAssetView[]> {
    await delay(80);
    return this.videos.filter(
      (v) => (!filter?.source || v.source === filter.source) && (!filter?.channel || v.channel === filter.channel),
    );
  }
  async listVideoChannels(): Promise<string[]> {
    await delay(40);
    return [...new Set(this.videos.map((v) => v.channel).filter((c): c is string => !!c))];
  }
  async createExternalVideo(input: CreateExternalVideo): Promise<VideoAssetView> {
    await delay();
    const v: VideoAssetView = {
      id: id('vid'),
      title: input.title,
      description: input.description ?? '',
      source: input.source,
      url: input.externalUrl,
      externalUrl: input.externalUrl,
      externalId: null,
      channel: input.channel ?? null,
      thumbnailUrl: null,
      durationSec: null,
      transcript: [],
      transcriptStatus: 'none',
      createdAt: new Date().toISOString(),
    };
    this.videos.unshift(v);
    return v;
  }
  async uploadVideoAsset(file: File, meta?: { title?: string; channel?: string }): Promise<VideoAssetView> {
    await delay();
    const v: VideoAssetView = {
      id: id('vid'),
      title: meta?.title ?? file.name.replace(/\.[^.]+$/, ''),
      description: '',
      source: 'upload',
      url: URL.createObjectURL(file),
      externalUrl: null,
      externalId: null,
      channel: meta?.channel ?? null,
      thumbnailUrl: null,
      durationSec: null,
      transcript: [],
      transcriptStatus: 'ready',
      createdAt: new Date().toISOString(),
    };
    this.videos.unshift(v);
    return v;
  }
  async updateVideoAsset(vid: string, input: UpdateVideoAsset): Promise<VideoAssetView> {
    await delay();
    const v = this.videos.find((x) => x.id === vid);
    if (!v) throw new Error('Video non trovato');
    if (input.title !== undefined) v.title = input.title;
    if (input.description !== undefined) v.description = input.description;
    if (input.channel !== undefined) v.channel = input.channel;
    return { ...v };
  }
  async deleteVideoAsset(vid: string): Promise<void> {
    await delay();
    this.videos = this.videos.filter((x) => x.id !== vid);
  }
  async attachVideoFromLibrary(courseId: string, lessonId: string, blockId: string, videoAssetId: string): Promise<void> {
    await delay();
    const asset = this.videos.find((v) => v.id === videoAssetId);
    const lesson = this.findLesson(courseId, lessonId);
    const block = lesson.blocks.find((b) => b.id === blockId);
    if (!asset || !block) return;
    const payload = (block.payload ?? {}) as Record<string, unknown>;
    payload.video = {
      kind: 'video',
      source: asset.source,
      storageKey: asset.source === 'upload' ? asset.url ?? undefined : undefined,
      externalUrl: asset.externalUrl ?? undefined,
      externalId: asset.externalId ?? undefined,
      alt: asset.title,
    };
    payload.transcript = asset.transcript;
    payload.transcriptStatus = asset.transcriptStatus;
    (block as { payload: unknown }).payload = payload;
  }
  async setVideoTranscript(courseId: string, lessonId: string, blockId: string, transcript: TranscriptCue[]): Promise<void> {
    await delay();
    const lesson = this.findLesson(courseId, lessonId);
    const block = lesson.blocks.find((b) => b.id === blockId);
    if (!block) return;
    const sorted = [...transcript].sort((a, b) => a.start - b.start);
    const payload = (block.payload ?? {}) as Record<string, unknown>;
    payload.transcript = sorted;
    payload.transcriptStatus = sorted.length > 0 ? 'ready' : 'none';
    (block as { payload: unknown }).payload = payload;
  }

  async searchStockImages(_courseId: string, q: string): Promise<StockImageSearchResponse> {
    await delay();
    if (!q.trim()) return { provider: 'pexels', results: [] };
    const results = Array.from({ length: 6 }).map((_, i) => ({
      id: `mock-${i}`,
      provider: 'pexels' as const,
      thumbUrl: `https://picsum.photos/seed/${encodeURIComponent(q)}-${i}/320/240`,
      alt: `${q} (immagine di esempio ${i + 1})`,
      authorName: `Autore ${i + 1}`,
      authorUrl: 'https://www.pexels.com',
      sourceUrl: 'https://www.pexels.com',
      width: 1920,
      height: 1280,
    }));
    return { provider: 'pexels', results };
  }
  async attachStockImage(
    _courseId: string,
    _lessonId: string,
    _input: AttachStockImageInput,
  ): Promise<{ attached: true; url: string }> {
    await delay();
    return { attached: true, url: 'https://picsum.photos/seed/attached/1280/720' };
  }
  async attachStockCover(
    _courseId: string,
    _input: AttachStockCoverInput,
  ): Promise<{ attached: true; url: string }> {
    await delay();
    return { attached: true, url: 'https://picsum.photos/seed/cover/1280/720' };
  }
  async attachStockModuleCover(
    _courseId: string,
    _moduleId: string,
    _input: AttachStockCoverInput,
  ): Promise<{ attached: true; url: string }> {
    await delay();
    return { attached: true, url: 'https://picsum.photos/seed/modcover/1280/720' };
  }

  private findLesson(courseId: string, lessonId: string): LessonView {
    for (const m of this.modules[courseId] ?? []) {
      const l = m.lessons.find((x) => x.id === lessonId);
      if (l) return l;
    }
    throw new Error('Lezione non trovata');
  }
  private pushAudit(action: string, resourceType: string, resourceId: string) {
    this.audit.push({ id: id('aud'), action, resourceType, resourceId, userId: 'u-dev', createdAt: new Date().toISOString() });
  }
}
