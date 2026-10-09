import type {
  Brief,
  BriefDraft,
  Block,
  PlanLimits,
  FeatureFlags,
  QuotaResource,
  CourseCostSummary,
  PricingQuote,
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
  StockImageResult,
  StockImageSearchResponse,
  AttachStockImageInput,
  AttachStockCoverInput,
} from '@scorm/contracts';

/**
 * Tipi di view dell'API lato client. Riusano gli schema di @scorm/contracts
 * dove possibile (fonte di verità unica con il backend) e aggiungono le forme
 * specifiche delle risposte REST.
 */

export type EditorialStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED';
export type ScormProfile = 'SCORM_2004_4TH' | 'SCORM_12';
export type KnowledgeScope = 'GLOBAL' | 'COURSE';
export type IngestStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';

export interface CourseView {
  id: string;
  title: string;
  description: string;
  language: string;
  status: EditorialStatus;
  brief: BriefDraft | null;
  /** URL firmato della copertina generata, se presente. */
  coverImageUrl?: string;
  /** Attribuzione della copertina se da libreria stock (credito autore). */
  coverAttribution?: { provider: string; authorName: string; authorUrl?: string; sourceUrl?: string };
  /** Stile delle micro-interazioni del corso: 'sober' (default) | 'lively'. */
  interactionStyle?: 'sober' | 'lively';
  /** Brand primario del corso (colori/logo/accenti in anteprima + export). */
  primaryBrandId?: string;
  /** Docente/relatore del corso (header sempre visibile). */
  instructor?: { name: string; role?: string; avatarUrl?: string };
  /** Cartella di organizzazione (null = radice). */
  folderId?: string | null;
}

export interface ModuleView {
  id: string;
  title: string;
  summary?: string | null;
  /** Obiettivi didattici del modulo (overview). */
  objectives?: string[];
  /** URL firmato della copertina del modulo, se generata. */
  coverImageUrl?: string;
  position: number;
  status: EditorialStatus;
  lessons: LessonView[];
}

export interface LessonView {
  id: string;
  title: string;
  position: number;
  status: EditorialStatus;
  objectives: string[];
  blocks: Block[];
  updatedAt: string;
  /** URL firmato della narrazione audio generata, se presente. */
  narrationUrl?: string;
  /** Lezione video-first (incentrata su un video). */
  videoFirst?: boolean;
}

/** Chunk della knowledge per il widget RAG "Chiedi al corso". */
export interface RagChunk {
  text: string;
  documentName: string;
  section?: string;
  /** Origine del chunk: per i contenuti del corso, riferimento alla lezione. */
  ref?: {
    kind: 'lesson' | 'knowledge';
    lessonId?: string;
    moduleIndex?: number;
    lessonIndex?: number;
  };
}

/** Chunk + embeddings neurali del corso (per la ricerca semantica in anteprima). */
export interface RagEmbeddingsView {
  chunks: RagChunk[];
  /** Id del modello di embedding (deve combaciare col pacchetto SCORM). */
  model: string;
  /** Dimensione dei vettori (es. 384). */
  dim: number;
  /** Numero di chunk (== embeddings se presenti). */
  count: number;
  /** Embeddings int8 quantizzati (scala 127) in base64, o null se non disponibili. */
  embeddingsB64: string | null;
}

export interface KnowledgeDocView {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  scope: KnowledgeScope;
  courseId: string | null;
  status: IngestStatus;
}

export interface BrandView {
  id: string;
  tenantId: string;
  name: string;
  assets: { logoPrimaryUrl: string; logoInverseUrl?: string; faviconUrl?: string };
  colors: Record<string, string>;
  typography: { fontFamilyHeading: string; fontFamilyBody: string; webFontUrls?: string[] };
  voice?: { tone: string; dosAndDonts?: string[] };
}

export interface QuotaStatus {
  resource: QuotaResource;
  limit: number | null;
  current: number;
  remaining: number | null;
}

export interface UsageView {
  featureFlags: FeatureFlags;
  quotas: QuotaStatus[];
}

export interface AuditEventView {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  userId: string | null;
  createdAt: string;
}

export interface ExportResultView {
  packageId: string;
  version: number;
  downloadUrl: string;
  sizeBytes: number;
  warnings: string[];
}

export interface CourseOutlineView {
  title: string;
  description: string;
  language: string;
  modules: Array<{
    title: string;
    summary?: string;
    lessons: Array<{ title: string; objectives: string[]; suggestedBlockTypes: string[] }>;
    hasIntermediateAssessment: boolean;
  }>;
  hasFinalAssessment: boolean;
}

/** Avvio di un job di generazione asincrono: ritorna l'id per il polling. */
export interface JobRef {
  jobId: string;
}

export type JobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

/** Stato di un job di generazione AI (polling). */
export interface JobView {
  id: string;
  type: string;
  status: JobStatus;
  /** Lezione associata (job per-lezione), per ricollegare lo stato UI. */
  lessonId?: string;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

/** Corso del tenant con generazione attiva (badge "in generazione"). */
export interface ActiveCourseJobs {
  courseId: string;
  jobs: number;
}

/** Interfaccia dell'API client: implementata da adapter reale e mock. */
/** Vista leggera di un assessment per l'indice dell'anteprima. */
export interface AssessmentIndexView {
  id: string;
  title: string;
  scope: 'intermediate' | 'final';
  moduleId?: string;
}

/** Ruoli utente (gerarchia OWNER ⊇ ADMIN ⊇ EDITOR ⊇ VIEWER). */
export type AppUserRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';

/** Vista di un utente del tenant per il pannello admin. */
export interface AdminUserView {
  id: string;
  email: string;
  displayName: string | null;
  role: AppUserRole;
  createdAt: string;
}

export interface ApiClient {
  // Corsi
  listCourses(filter?: { folderId?: string | 'root'; q?: string }): Promise<CourseView[]>;
  getCourse(id: string): Promise<CourseView>;
  createCourse(input: { title: string; description?: string; language: string }): Promise<CourseView>;
  deleteCourse(id: string): Promise<void>;
  saveBrief(courseId: string, brief: Brief): Promise<CourseView>;
  saveBriefDraft(courseId: string, draft: BriefDraft): Promise<CourseView>;
  updateCourseSettings(
    courseId: string,
    settings: {
      interactionStyle?: 'sober' | 'lively';
      primaryBrandId?: string;
      instructor?: { name?: string; role?: string; avatarKey?: string };
    },
  ): Promise<CourseView>;
  uploadInstructorAvatar(courseId: string, file: File): Promise<{ avatarKey: string; avatarUrl: string }>;
  listModules(courseId: string): Promise<ModuleView[]>;
  listAssessments(courseId: string): Promise<AssessmentIndexView[]>;
  addModule(courseId: string, input: { title: string; summary?: string }): Promise<ModuleView>;
  addLesson(courseId: string, moduleId: string, input: { title: string }): Promise<LessonView>;
  deleteModule(courseId: string, moduleId: string): Promise<void>;
  deleteLesson(courseId: string, moduleId: string, lessonId: string): Promise<void>;
  /** Materializza l'outline generato dall'AI in moduli/lezioni (idempotente). */
  applyOutline(courseId: string): Promise<ModuleView[]>;

  // Generazione (asincrona: ritorna { jobId }, poi polling via getJob)
  generateOutline(courseId: string): Promise<JobRef>;
  generateLessonContent(courseId: string, lessonId: string, toneInstruction?: string): Promise<JobRef>;
  /** Genera i contenuti di TUTTE le lezioni vuote in un unico job server-side. */
  generateAllContent(courseId: string): Promise<JobRef>;
  /** Corsi del tenant con generazione attiva (per il badge "in generazione"). */
  listActiveCourseIds(): Promise<ActiveCourseJobs[]>;
  /** Carica un video dell'utente e lo associa al segnaposto video di un block. */
  uploadLessonVideo(courseId: string, lessonId: string, blockId: string, file: File): Promise<{ storageKey: string; url: string }>;
  // Media: ancora sincrone (durata contenuta); ritornano il risultato diretto.
  generateLessonImages(courseId: string, lessonId: string): Promise<{ generated: number; skipped: number; failed: number; warnings: string[] }>;
  generateLessonNarration(courseId: string, lessonId: string): Promise<{ url: string; bytes: number; voice: string }>;
  generateCover(courseId: string): Promise<{ url: string }>;
  generateModuleCover(courseId: string, moduleId: string): Promise<{ url: string }>;

  // Job di generazione (polling)
  getJob(courseId: string, jobId: string): Promise<JobView>;
  listActiveJobs(courseId: string): Promise<JobView[]>;

  // Editor HITL
  editLessonBlocks(courseId: string, lessonId: string, blocks: Block[], expectedUpdatedAt: string): Promise<LessonView>;
  setStatus(courseId: string, entity: 'course' | 'module' | 'lesson' | 'assessment', entityId: string, status: EditorialStatus): Promise<void>;
  setLessonVideoFirst(courseId: string, moduleId: string, lessonId: string, videoFirst: boolean): Promise<void>;
  /** Chunk della knowledge del corso per il widget RAG (anteprima). */
  getRagChunks(courseId: string): Promise<RagChunk[]>;
  /** Chunk + embeddings neurali del corso per la ricerca semantica in anteprima. */
  getRagEmbeddings(courseId: string): Promise<RagEmbeddingsView>;

  // Knowledge
  listKnowledge(scope?: KnowledgeScope, courseId?: string): Promise<KnowledgeDocView[]>;
  uploadKnowledge(file: File, scope: KnowledgeScope, courseId?: string): Promise<KnowledgeDocView>;
  deleteKnowledge(id: string): Promise<void>;

  // Brand
  listBrands(): Promise<BrandView[]>;
  getBrand(id: string): Promise<BrandView>;
  createBrand(def: Omit<BrandView, 'id' | 'tenantId'>): Promise<BrandView>;
  updateBrand(id: string, def: Omit<BrandView, 'id' | 'tenantId'>): Promise<BrandView>;
  deleteBrand(id: string): Promise<void>;

  // Export
  exportCourse(courseId: string, brandId: string, profile: ScormProfile, allowUnapproved?: boolean, includeSemanticSearch?: boolean): Promise<ExportResultView>;

  // Usage / audit
  getUsage(): Promise<UsageView>;
  listAudit(): Promise<AuditEventView[]>;

  // Costi / pricing
  getCourseCost(courseId: string): Promise<CourseCostSummary>;
  getCourseQuote(courseId: string, input: PricingQuoteInput): Promise<CourseQuoteView>;

  // Cartelle
  listFolders(): Promise<FolderView[]>;
  createFolder(input: CreateFolder): Promise<FolderView>;
  updateFolder(id: string, input: UpdateFolder): Promise<FolderView>;
  deleteFolder(id: string): Promise<void>;
  moveCourse(courseId: string, folderId: string | null): Promise<void>;

  // Branding white-label della web app (per-tenant)
  getBranding(): Promise<AppBrandingView>;
  updateBranding(patch: UpdateAppBranding): Promise<AppBrandingView>;
  uploadBrandingAsset(kind: 'logo' | 'favicon', file: File): Promise<AppBrandingView>;

  // Gestione utenti del tenant (admin): elenco e invito
  listUsers(): Promise<AdminUserView[]>;
  createUser(input: { email: string; displayName?: string; role: AppUserRole }): Promise<AdminUserView>;

  // Libreria video per-tenant
  listVideos(filter?: { source?: string; channel?: string }): Promise<VideoAssetView[]>;
  listVideoChannels(): Promise<string[]>;
  createExternalVideo(input: CreateExternalVideo): Promise<VideoAssetView>;
  uploadVideoAsset(file: File, meta?: { title?: string; channel?: string }): Promise<VideoAssetView>;
  updateVideoAsset(id: string, input: UpdateVideoAsset): Promise<VideoAssetView>;
  deleteVideoAsset(id: string): Promise<void>;
  /** Collega un video della libreria a un block video_checkpoint di una lezione. */
  attachVideoFromLibrary(courseId: string, lessonId: string, blockId: string, videoAssetId: string): Promise<void>;
  /** Salva/corregge a mano la trascrizione (cue con timestamp) di un block video. */
  setVideoTranscript(
    courseId: string,
    lessonId: string,
    blockId: string,
    transcript: TranscriptCue[],
  ): Promise<void>;

  // Immagini stock royalty-free (Pexels/Unsplash astratti)
  /** Cerca immagini stock per query testuale (provider configurato lato server). */
  searchStockImages(courseId: string, q: string): Promise<StockImageSearchResponse>;
  /** Scarica e collega un'immagine stock a un block immagine di una lezione. */
  attachStockImage(
    courseId: string,
    lessonId: string,
    input: AttachStockImageInput,
  ): Promise<{ attached: true; url: string }>;
  /** Imposta un'immagine stock come copertina del corso. */
  attachStockCover(courseId: string, input: AttachStockCoverInput): Promise<{ attached: true; url: string }>;
  /** Imposta un'immagine stock come copertina di un modulo. */
  attachStockModuleCover(
    courseId: string,
    moduleId: string,
    input: AttachStockCoverInput,
  ): Promise<{ attached: true; url: string }>;
}

/** Preventivo del corso: quote + riepilogo costi incluso. */
export type CourseQuoteView = PricingQuote & { summary: CourseCostSummary };

export type {
  Brief,
  BriefDraft,
  Block,
  PlanLimits,
  FeatureFlags,
  QuotaResource,
  CourseCostSummary,
  PricingQuote,
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
  StockImageResult,
  StockImageSearchResponse,
  AttachStockImageInput,
  AttachStockCoverInput,
};
