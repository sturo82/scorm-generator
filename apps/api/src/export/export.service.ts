import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Brand, Brief, Course, type Course as CourseType, type Brand as BrandType } from '@scorm/contracts';
import {
  buildScormPackage,
  ragRuntimeText,
  embedTexts,
  EMBED_MODEL_ID,
  EMBED_DIM,
  type RagChunkInput,
} from '@scorm/scorm';
import type { ScormProfile as PrismaScormProfile } from '@prisma/client';
import type { ObjectStorage } from '@scorm/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { QuotaService } from '../plans/quota.service.js';
import { AuditService } from '../observability/audit.service.js';
import { RetrievalService } from '../knowledge/retrieval.service.js';
import { OBJECT_STORAGE } from '../providers/provider.constants.js';
import type { AuthContext } from '../auth/auth-context.js';

export interface ExportInput {
  tenantId: string;
  courseId: string;
  /** Brand da usare; se assente si usa il brand primario del corso. */
  brandId?: string;
  profile: PrismaScormProfile;
  allowUnapproved?: boolean;
  /** Attiva la ricerca semantica (TF-IDF cosine) nel pacchetto SCORM. */
  includeSemanticSearch?: boolean;
  /** Contesto per l'audit (opzionale: assente nei test unitari). */
  authContext?: AuthContext;
}

export interface ExportResult {
  packageId: string;
  version: number;
  downloadUrl: string;
  sizeBytes: number;
  warnings: string[];
}

/**
 * Export per brand (Requisito 7.3 / 9.3 / 9.7). Materializza un CourseBrandBuild
 * (corso + brand + profilo), costruisce il pacchetto SCORM, lo salva su storage
 * e crea un ScormPackage versionato. Lo stesso corso con brand diversi produce
 * build e pacchetti distinti.
 */
@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
    private readonly audit: AuditService,
    private readonly retrieval: RetrievalService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async exportCourse(input: ExportInput): Promise<ExportResult> {
    // Quota export mensili (Requisito 1.5).
    await this.quota.assertWithinLimit(input.tenantId, 'exportsPerMonth');

    const course = await this.loadCourse(input.tenantId, input.courseId);
    // Brand: quello richiesto esplicitamente, altrimenti il brand primario del
    // corso. Senza né l'uno né l'altro, errore chiaro.
    const brandId = input.brandId ?? course.primaryBrandId;
    if (!brandId) {
      throw new BadRequestException(
        'Nessun brand specificato e il corso non ha un brand primario: scegline uno.',
      );
    }
    const brand = await this.loadBrand(input.tenantId, brandId);

    // Build o riuso del CourseBrandBuild (corso+brand+profilo).
    const build =
      (await this.prisma.courseBrandBuild.findFirst({
        where: { courseId: input.courseId, brandId, profile: input.profile },
      })) ??
      (await this.prisma.courseBrandBuild.create({
        data: { courseId: input.courseId, brandId, profile: input.profile },
      }));

    // Nuova versione incrementale del pacchetto.
    const last = await this.prisma.scormPackage.findFirst({
      where: { buildId: build.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;

    const pkg = await this.prisma.scormPackage.create({
      data: { buildId: build.id, version, status: 'BUILDING' },
    });

    // Indice RAG offline: chunk della knowledge del corso (rispetta la whitelist
    // knowledgeDocIds del brief). Best-effort: un errore qui non blocca l'export.
    const ragChunks = await this.loadRagChunks(input.tenantId, input.courseId);

    // Embeddings neurali dei chunk (ricerca semantica offline). Calcolati con lo
    // STESSO modello che gira nel browser (pacchetto SCORM + anteprima) sul
    // testo già normalizzato (ragRuntimeText), così il cosine query↔chunk è
    // coerente ovunque. Si usa la cache condivisa con l'anteprima: il blob int8
    // viene riconvertito in float (÷127) e il builder lo ri-quantizza agli stessi
    // byte → ranking IDENTICO anteprima↔pacchetto. Best-effort: senza embeddings
    // il pacchetto resta lessicale.
    const ragEmbeddings = await this.loadRagEmbeddingsForBuild(input.tenantId, input.courseId, ragChunks);

    // Metadati descrittivi per sw-course.json (dal brief): durata, categoria,
    // mastery. Best-effort: se il brief manca o è malformato, si omettono.
    const descriptor = await this.buildDescriptor(input.tenantId, input.courseId);

    try {
      const result = await buildScormPackage({
        course,
        brand,
        profile: input.profile === 'SCORM_12' ? 'SCORM_12' : 'SCORM_2004_4TH',
        allowUnapproved: input.allowUnapproved,
        includeSemanticSearch: input.includeSemanticSearch,
        ragChunks,
        ragEmbeddings,
        descriptor,
        // Scarica i media (chiavi S3) per includerli nel pacchetto offline.
        fetchMedia: async (storageKey: string) => {
          try {
            const bytes = await this.storage.getObject(storageKey);
            return { bytes, contentType: contentTypeForKey(storageKey) };
          } catch {
            return null;
          }
        },
      });

      const storageKey = `packages/${input.tenantId}/${input.courseId}/${build.id}/v${version}.zip`;
      await this.storage.putObject(storageKey, result.zip, { contentType: 'application/zip' });

      await this.prisma.scormPackage.update({
        where: { id: pkg.id },
        data: { status: 'READY', storageKey, sizeBytes: result.zip.byteLength },
      });

      const downloadFilename = `${slugify(course.title) || 'corso'}-scorm.zip`;
      const downloadUrl = await this.storage.getSignedUrl(storageKey, {
        expiresInSec: 600,
        downloadFilename,
      });

      if (input.authContext) {
        await this.audit.record(input.authContext, {
          action: 'course.export',
          resourceType: 'course',
          resourceId: input.courseId,
          metadata: { brandId, profile: input.profile, version },
        });
      }

      return {
        packageId: pkg.id,
        version,
        downloadUrl,
        sizeBytes: result.zip.byteLength,
        warnings: [...result.validation.warnings, ...result.themeWarnings, ...result.mediaWarnings],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Errore di build';
      await this.prisma.scormPackage.update({
        where: { id: pkg.id },
        data: { status: 'FAILED', error: message },
      });
      throw err;
    }
  }

  private async loadCourse(tenantId: string, courseId: string): Promise<CourseType> {
    const row = await this.prisma.course.findFirst({
      where: { id: courseId, tenantId },
      include: {
        modules: {
          orderBy: { position: 'asc' },
          include: { lessons: { orderBy: { position: 'asc' } } },
        },
        assessments: { include: { questions: { orderBy: { position: 'asc' } } } },
      },
    });
    if (!row) throw new NotFoundException('Corso non trovato');

    // Ricompone il modello del corso conforme ai contratti dai dati DB (JSONB).
    return Course.parse({
      id: row.id,
      tenantId: row.tenantId,
      title: row.title,
      description: row.description,
      language: row.language,
      coverImageKey: row.coverImageKey ?? undefined,
      interactionStyle: row.interactionStyle === 'lively' ? 'lively' : 'sober',
      navPosition: row.navPosition === 'top' ? 'top' : 'side',
      primaryBrandId: row.primaryBrandId ?? undefined,
      instructor: row.instructorName
        ? {
            name: row.instructorName,
            role: row.instructorRole ?? undefined,
            avatarKey: row.instructorAvatarKey ?? undefined,
          }
        : undefined,
      editorial: { status: statusToDomain(row.status), citations: [] },
      modules: row.modules.map((m) => ({
        id: m.id,
        title: m.title,
        summary: m.summary ?? undefined,
        objectives: Array.isArray(m.objectives) ? (m.objectives as string[]) : [],
        coverImageKey: m.coverImageKey ?? undefined,
        editorial: { status: statusToDomain(m.status), citations: [] },
        lessons: m.lessons.map((l) => ({
          id: l.id,
          title: l.title,
          objectives: Array.isArray(l.objectives) ? (l.objectives as string[]) : [],
          editorial: { status: statusToDomain(l.status), citations: [] },
          blocks: Array.isArray(l.blocks) ? l.blocks : [],
          narrationKey: l.narrationKey ?? undefined,
          videoFirst: l.videoFirst === true,
        })),
      })),
      // Scarta gli assessment senza domande: lo schema richiede min 1 domanda e
      // un test vuoto (es. generazione incompleta) non è esportabile. Meglio
      // ometterlo che far fallire l'intero export con un 500.
      assessments: row.assessments
        .filter((a) => Array.isArray(a.questions) && a.questions.length > 0)
        .map((a) => ({
          id: a.id,
          title: a.title,
          scope: a.scope === 'FINAL' ? 'final' : 'intermediate',
          moduleId: a.moduleId ?? undefined,
          masteryScore: a.masteryScore,
          maxAttempts: a.maxAttempts ?? undefined,
          shuffleQuestions: a.shuffleQuestions,
          shuffleAnswers: a.shuffleAnswers,
          editorial: { status: statusToDomain(a.status), citations: [] },
          questions: a.questions.map((q) => q.payload),
        })),
    });
  }

  /**
   * Chunk RAG del corso per l'anteprima web (stesso set del pacchetto SCORM, per
   * fedeltà 100%). Verifica l'appartenenza del corso al tenant.
   */
  /**
   * Chunk RAG del corso + embeddings neurali (int8, base64) per l'anteprima.
   * Gli embeddings sono calcolati con lo STESSO modello e sullo STESSO testo
   * normalizzato che finisce nel pacchetto SCORM: l'anteprima usa questi vettori
   * (non li ricalcola) e embedda solo la query a runtime con lo stesso modello →
   * ranking IDENTICO ad anteprima e pacchetto. Se gli embeddings non sono
   * calcolabili, ritorna embeddings=null e l'anteprima usa il lessicale.
   */
  async getRagEmbeddings(
    tenantId: string,
    courseId: string,
  ): Promise<{
    chunks: RagChunkInput[];
    model: string;
    dim: number;
    count: number;
    embeddingsB64: string | null;
  }> {
    const course = await this.prisma.course.findFirst({ where: { id: courseId, tenantId } });
    if (!course) throw new NotFoundException('Corso non trovato');
    const chunks = await this.loadRagChunks(tenantId, courseId);
    // La cache evita di ricalcolare i vettori (minuti) a ogni apertura.
    const buf = await this.getOrComputeEmbeddingBuffer(tenantId, courseId, chunks);
    return {
      chunks,
      model: EMBED_MODEL_ID,
      dim: EMBED_DIM,
      count: chunks.length,
      embeddingsB64: buf ? buf.toString('base64') : null,
    };
  }

  /**
   * Hash del contenuto dei chunk (testo ordinato) + modello + dim. È la chiave
   * di validità della cache: se cambia anche solo un chunk, l'hash cambia e gli
   * embeddings vengono ricalcolati. Deterministico e indipendente dall'ordine
   * di storage (i chunk hanno già un ordinamento deterministico a monte).
   */
  private computeContentHash(chunks: RagChunkInput[]): string {
    const h = createHash('sha256');
    h.update(`${EMBED_MODEL_ID}\u0000${EMBED_DIM}\u0000${chunks.length}`);
    for (const c of chunks) h.update(`\u0000${c.text}`);
    return h.digest('hex');
  }

  /**
   * Quantizza i vettori float in int8 (scala 127) ESATTAMENTE come il builder
   * del pacchetto SCORM → gli stessi byte servono anteprima ed export, quindi il
   * ranking è identico ovunque.
   */
  private quantizeInt8(vectors: number[][], count: number): Buffer {
    const buf = Buffer.alloc(count * EMBED_DIM);
    for (let i = 0; i < vectors.length; i++) {
      const v = vectors[i] ?? [];
      for (let j = 0; j < EMBED_DIM; j++) {
        const x = Math.max(-1, Math.min(1, v[j] ?? 0));
        // Int8 in [-128,127]; i valori negativi come signed byte.
        buf[i * EMBED_DIM + j] = Math.round(x * 127) & 0xff;
      }
    }
    return buf;
  }

  /**
   * Ritorna il blob int8 degli embeddings dei chunk, usando la cache per corso.
   * - HIT (hash coincide): ritorna i byte memorizzati in millisecondi.
   * - MISS/stale: calcola i vettori (lento), salva in cache e ritorna i byte.
   * - Se il calcolo non è possibile (0 chunk o errore modello): ritorna null e
   *   il consumatore resta sul lessicale.
   * Best-effort su DB: un errore di lettura/scrittura cache non blocca mai la
   * richiesta (si ricalcola o si prosegue senza cache).
   */
  private async getOrComputeEmbeddingBuffer(
    tenantId: string,
    courseId: string,
    chunks: RagChunkInput[],
  ): Promise<Buffer | null> {
    if (chunks.length === 0) return null;
    const contentHash = this.computeContentHash(chunks);

    // 1) Tenta la cache.
    try {
      const cached = await this.prisma.ragEmbeddingCache.findUnique({ where: { courseId } });
      if (
        cached &&
        cached.contentHash === contentHash &&
        cached.model === EMBED_MODEL_ID &&
        cached.dim === EMBED_DIM &&
        cached.count === chunks.length &&
        cached.embeddings.length === chunks.length * EMBED_DIM
      ) {
        return Buffer.from(cached.embeddings);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'errore';
      // eslint-disable-next-line no-console
      console.warn(`[export] lettura cache embeddings fallita: ${msg}`);
    }

    // 2) MISS/stale → calcola (lento) e quantizza.
    const vectors = await this.computeRagEmbeddings(chunks);
    if (!vectors || vectors.length !== chunks.length) return null;
    const buf = this.quantizeInt8(vectors, chunks.length);

    // 3) Salva in cache (best-effort: non blocca la risposta).
    try {
      await this.prisma.ragEmbeddingCache.upsert({
        where: { courseId },
        create: {
          courseId,
          tenantId,
          contentHash,
          model: EMBED_MODEL_ID,
          dim: EMBED_DIM,
          count: chunks.length,
          embeddings: buf,
        },
        update: {
          tenantId,
          contentHash,
          model: EMBED_MODEL_ID,
          dim: EMBED_DIM,
          count: chunks.length,
          embeddings: buf,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'errore';
      // eslint-disable-next-line no-console
      console.warn(`[export] scrittura cache embeddings fallita: ${msg}`);
    }

    return buf;
  }

  /**
   * Embeddings per il builder SCORM: riusa la cache (int8) condivisa con
   * l'anteprima e li riconverte in float (÷127). Il builder ri-quantizza agli
   * STESSI byte, quindi anteprima e pacchetto hanno vettori identici. Ritorna
   * undefined se non disponibili (pacchetto lessicale).
   */
  private async loadRagEmbeddingsForBuild(
    tenantId: string,
    courseId: string,
    chunks: RagChunkInput[],
  ): Promise<number[][] | undefined> {
    const buf = await this.getOrComputeEmbeddingBuffer(tenantId, courseId, chunks);
    if (!buf) return undefined;
    const vectors: number[][] = new Array(chunks.length);
    for (let i = 0; i < chunks.length; i++) {
      const v = new Array<number>(EMBED_DIM);
      for (let j = 0; j < EMBED_DIM; j++) {
        // byte uint8 → int8 → float in [-1,1] (÷127), inverso di quantizeInt8.
        const b = buf[i * EMBED_DIM + j] ?? 0;
        v[j] = ((b << 24) >> 24) / 127;
      }
      vectors[i] = v;
    }
    return vectors;
  }

  async getRagChunks(tenantId: string, courseId: string): Promise<RagChunkInput[]> {
    const course = await this.prisma.course.findFirst({ where: { id: courseId, tenantId } });
    if (!course) throw new NotFoundException('Corso non trovato');
    return this.loadRagChunks(tenantId, courseId);
  }

  /**
   * Costruisce i metadati descrittivi per sw-course.json a partire dal brief e
   * dagli assessment del corso: durata stimata e punteggio di superamento (dal
   * mastery dell'assessment finale, convertito 0..1 → 0..100). Best-effort: in
   * caso di dati mancanti ritorna un oggetto parziale (i campi vuoti sono omessi
   * dal JSON dal builder).
   */
  private async buildDescriptor(
    tenantId: string,
    courseId: string,
  ): Promise<{ durationMinutes?: number; masteryScore?: number }> {
    const descriptor: { durationMinutes?: number; masteryScore?: number } = {};
    try {
      const row = await this.prisma.course.findFirst({
        where: { id: courseId, tenantId },
        select: { brief: true },
      });
      const brief = row?.brief ? Brief.safeParse(row.brief) : null;
      if (brief?.success && brief.data.estimatedDurationMinutes > 0) {
        descriptor.durationMinutes = brief.data.estimatedDurationMinutes;
      }
      // Mastery dall'assessment finale (0..1 nel dominio → 0..100 nel descriptor).
      const finalAssessment = await this.prisma.assessment.findFirst({
        where: { courseId, scope: 'FINAL' },
        select: { masteryScore: true },
      });
      if (finalAssessment && typeof finalAssessment.masteryScore === 'number') {
        descriptor.masteryScore = Math.round(finalAssessment.masteryScore * 100);
      }
    } catch {
      // Best-effort: nessun descriptor extra.
    }
    return descriptor;
  }

  private async loadBrand(tenantId: string, brandId: string): Promise<BrandType> {
    const row = await this.prisma.brand.findFirst({ where: { id: brandId, tenantId } });
    if (!row) throw new NotFoundException('Brand non trovato');
    return Brand.parse({ ...(row.definition as object), id: row.id, tenantId });
  }

  /**
   * Carica i chunk della knowledge del corso per il RAG offline, rispettando la
   * whitelist knowledgeDocIds del brief (se presente). Best-effort: in caso di
   * errore ritorna lista vuota (il widget semplicemente non avrà contenuti).
   */
  /**
   * Calcola gli embeddings neurali dei chunk RAG (per la ricerca semantica
   * offline). Usa il modello MiniLM vendorato, sullo STESSO testo normalizzato
   * dei chunk. Best-effort: in caso di errore ritorna undefined e il pacchetto
   * resta sulla ricerca lessicale (BM25 + TF-IDF).
   */
  private async computeRagEmbeddings(
    chunks: RagChunkInput[],
  ): Promise<number[][] | undefined> {
    if (chunks.length === 0) return undefined;
    try {
      return await embedTexts(chunks.map((c) => c.text));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'errore';
      // Non blocca l'export: il RAG lessicale resta disponibile.
      // eslint-disable-next-line no-console
      console.warn(`[export] embeddings semantici non calcolati: ${msg}`);
      return undefined;
    }
  }

  private async loadRagChunks(tenantId: string, courseId: string): Promise<RagChunkInput[]> {
    try {
      const course = await this.prisma.course.findFirst({
        where: { id: courseId, tenantId },
        select: { brief: true },
      });
      const brief = (course?.brief ?? null) as { knowledgeDocIds?: string[] } | null;
      // 1) Chunk dai documenti della knowledge base (vector store).
      const docChunks = await this.retrieval.listCourseChunks({
        tenantId,
        courseId,
        documentIds: brief?.knowledgeDocIds,
      });
      const knowledge: RagChunkInput[] = docChunks.map((c) => ({
        text: ragRuntimeText(c.text),
        documentName: c.documentName,
        section: c.section,
        ref: { kind: 'knowledge' as const },
      }));
      // 2) Chunk dai contenuti delle LEZIONI del corso (per dire "argomento
      //    trattato in Modulo X › Lezione Y" e permettere il salto).
      const lessonChunks = await this.loadLessonChunks(tenantId, courseId);
      // Normalizza anche il testo delle lezioni allo stesso modo del runtime.
      const lessonNorm = lessonChunks.map((c) => ({ ...c, text: ragRuntimeText(c.text) }));
      return [...lessonNorm, ...knowledge];
    } catch {
      return [];
    }
  }

  /**
   * Costruisce chunk RAG dai contenuti delle lezioni (testo dei block rich_text),
   * con riferimento a Modulo/Lezione per attribuzione e salto nel widget.
   */
  private async loadLessonChunks(tenantId: string, courseId: string): Promise<RagChunkInput[]> {
    const row = await this.prisma.course.findFirst({
      where: { id: courseId, tenantId },
      include: {
        modules: {
          orderBy: { position: 'asc' },
          include: { lessons: { orderBy: { position: 'asc' } } },
        },
      },
    });
    if (!row) return [];
    const out: RagChunkInput[] = [];
    row.modules.forEach((m, mi) => {
      m.lessons.forEach((l, li) => {
        const text = extractLessonText(Array.isArray(l.blocks) ? (l.blocks as unknown[]) : []);
        if (!text || text.length < 40) return;
        out.push({
          text,
          documentName: `Modulo ${mi + 1} — Lezione ${li + 1}: ${l.title}`,
          section: l.title,
          ref: { kind: 'lesson', lessonId: l.id, moduleIndex: mi + 1, lessonIndex: li + 1 },
        });
      });
    });
    return out;
  }
}

/** Estrae il testo leggibile (plain) dai block rich_text di una lezione. */
function extractLessonText(blocks: unknown[]): string {
  const parts: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node === null || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const content = obj.content as { html?: string } | undefined;
    if (content && typeof content.html === 'string') {
      parts.push(content.html.replace(/<[^>]+>/g, ' '));
    }
    for (const v of Object.values(obj)) visit(v);
  };
  visit(blocks);
  return parts
    .join(' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Content-type dedotto dall'estensione della chiave S3 del media. */
function contentTypeForKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'mp3':
      return 'audio/mpeg';
    default:
      return 'application/octet-stream';
  }
}

/** Slug ASCII sicuro per il nome file del pacchetto scaricato. */
function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // rimuove i segni diacritici
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Mappa lo stato editoriale Prisma (maiuscolo) a quello di dominio. */
function statusToDomain(s: string): 'draft' | 'in_review' | 'approved' {
  switch (s) {
    case 'APPROVED':
      return 'approved';
    case 'IN_REVIEW':
      return 'in_review';
    default:
      return 'draft';
  }
}
