import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Brief, BriefDraft, type Brief as BriefType, type BriefDraft as BriefDraftType } from '@scorm/contracts';
import type { ObjectStorage } from '@scorm/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { QuotaService } from '../plans/quota.service.js';
import { OBJECT_STORAGE } from '../providers/provider.constants.js';

/** TTL dell'URL firmato per la copertina in anteprima. */
const COVER_URL_TTL_SEC = 6 * 3600;

export interface CreateCourseInput {
  tenantId: string;
  title: string;
  description?: string;
  language: string;
}

export type InteractionStyle = 'sober' | 'lively';

export interface CourseView {
  id: string;
  title: string;
  description: string;
  language: string;
  status: string;
  brief: BriefDraftType | null;
  /** URL firmato della copertina generata, se presente. */
  coverImageUrl?: string;
  /** Attribuzione della copertina se da libreria stock (credito autore). */
  coverAttribution?: { provider: string; authorName: string; authorUrl?: string; sourceUrl?: string };
  /** Stile delle micro-interazioni del corso. */
  interactionStyle: InteractionStyle;
  /** Brand primario del corso (colori/logo/accenti). */
  primaryBrandId?: string;
  /** Docente/relatore del corso (nome, ruolo, URL foto firmato). */
  instructor?: { name: string; role?: string; avatarUrl?: string };
  /** Cartella di organizzazione (null = radice). */
  folderId: string | null;
}

/** Filtri per l'elenco corsi: cartella e ricerca testuale. */
export interface ListCoursesFilter {
  /** 'root' = solo radice; stringa = quella cartella; undefined = tutti. */
  folderId?: string | 'root';
  /** Ricerca full-text su titolo/descrizione (case-insensitive). */
  q?: string;
}

/**
 * Gestione del corso e del suo brief (Requisito 2 / 4.2). Il brief è salvato
 * come JSONB su Course e validato con gli schema Zod dei contratti. La gerarchia
 * dei contenuti (moduli/lezioni) è gestita da ModulesService.
 */
@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async create(input: CreateCourseInput): Promise<CourseView> {
    // Quota sul numero di corsi del tenant (Requisito 1.5).
    await this.quota.assertWithinLimit(input.tenantId, 'courses');

    const course = await this.prisma.course.create({
      data: {
        tenantId: input.tenantId,
        title: input.title,
        description: input.description ?? '',
        language: input.language,
        status: 'DRAFT',
      },
    });
    return this.toView(course);
  }

  async list(tenantId: string, filter: ListCoursesFilter = {}): Promise<CourseView[]> {
    // La ricerca testuale è trasversale alle cartelle (cerca ovunque); il
    // filtro cartella si applica solo quando NON si sta cercando.
    const where: {
      tenantId: string;
      folderId?: string | null;
      OR?: Array<Record<string, unknown>>;
    } = { tenantId };
    const q = filter.q?.trim();
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    } else if (filter.folderId !== undefined) {
      where.folderId = filter.folderId === 'root' ? null : filter.folderId;
    }
    const courses = await this.prisma.course.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(courses.map((c) => this.toView(c)));
  }

  async get(tenantId: string, courseId: string): Promise<CourseView> {
    const course = await this.requireCourse(tenantId, courseId);
    return this.toView(course);
  }

  async delete(tenantId: string, courseId: string): Promise<void> {
    await this.requireCourse(tenantId, courseId);
    await this.prisma.course.delete({ where: { id: courseId } });
  }

  /**
   * Aggiorna le impostazioni di presentazione del corso. Per ora governa lo
   * stile delle micro-interazioni (sober/lively), propagato identico ad
   * anteprima web e player SCORM. Modificabile dopo la creazione (Blocco F).
   */
  async updateSettings(
    tenantId: string,
    courseId: string,
    settings: {
      interactionStyle?: InteractionStyle;
      primaryBrandId?: string | null;
      instructor?: { name?: string | null; role?: string | null; avatarKey?: string | null } | null;
    },
  ): Promise<CourseView> {
    await this.requireCourse(tenantId, courseId);
    const data: {
      interactionStyle?: string;
      primaryBrandId?: string | null;
      instructorName?: string | null;
      instructorRole?: string | null;
      instructorAvatarKey?: string | null;
    } = {};
    if (settings.interactionStyle) data.interactionStyle = settings.interactionStyle;
    if (settings.primaryBrandId !== undefined) {
      // Verifica che il brand appartenga al tenant (o azzera con null).
      if (settings.primaryBrandId) {
        const brand = await this.prisma.brand.findFirst({
          where: { id: settings.primaryBrandId, tenantId },
        });
        if (!brand) throw new BadRequestException('Brand non valido per il tenant');
      }
      data.primaryBrandId = settings.primaryBrandId;
    }
    if (settings.instructor !== undefined) {
      // null o nome vuoto azzera il docente (e la foto associata).
      const name = settings.instructor?.name?.trim();
      data.instructorName = name ? name : null;
      data.instructorRole = name ? (settings.instructor?.role?.trim() || null) : null;
      if (!name) data.instructorAvatarKey = null;
      else if (settings.instructor?.avatarKey !== undefined) {
        data.instructorAvatarKey = settings.instructor.avatarKey || null;
      }
    }
    const course = await this.prisma.course.update({
      where: { id: courseId },
      data,
    });
    return this.toView(course);
  }

  /**
   * Carica la foto del docente su object storage e persiste la chiave sul corso.
   * Salva la storageKey (non l'URL); l'URL firmato è risolto in lettura (toView)
   * e il file è scaricato ed embeddato nell'export SCORM (offline).
   */
  async uploadInstructorAvatar(
    tenantId: string,
    courseId: string,
    file: { mimeType: string; content: Buffer },
  ): Promise<{ avatarKey: string; avatarUrl: string }> {
    await this.requireCourse(tenantId, courseId);
    const ext = extForImageMime(file.mimeType);
    if (!ext) {
      throw new BadRequestException('Formato immagine non supportato (usa PNG, JPEG o WebP).');
    }
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.content.byteLength > MAX_BYTES) {
      throw new BadRequestException('Immagine troppo grande (max 5MB).');
    }
    const key = `media/${tenantId}/${courseId}/instructor/avatar-${randomUUID()}.${ext}`;
    await this.storage.putObject(key, file.content, { contentType: file.mimeType });
    await this.prisma.course.update({
      where: { id: courseId },
      data: { instructorAvatarKey: key },
    });
    const avatarUrl = await this.storage.getSignedUrl(key, { expiresInSec: COVER_URL_TTL_SEC });
    return { avatarKey: key, avatarUrl };
  }

  /**
   * Salva il brief come bozza (campi parziali). Non impone i campi obbligatori,
   * così l'utente può salvare e riprendere (Requisito 2.4).
   */
  async saveBriefDraft(
    tenantId: string,
    courseId: string,
    draft: BriefDraftType,
  ): Promise<CourseView> {
    await this.requireCourse(tenantId, courseId);
    await this.assertBrandsExist(tenantId, draft.brandIds);
    const parsed = BriefDraft.parse(draft);
    const course = await this.prisma.course.update({
      where: { id: courseId },
      data: { brief: parsed as object },
    });
    return this.toView(course);
  }

  /**
   * Salva un brief completo e valido (tutti i campi obbligatori presenti,
   * Requisito 2.2). Allinea titolo/lingua del corso al brief.
   */
  async saveBrief(tenantId: string, courseId: string, brief: BriefType): Promise<CourseView> {
    await this.requireCourse(tenantId, courseId);
    await this.assertBrandsExist(tenantId, brief.brandIds);
    const parsed = Brief.parse(brief);
    const course = await this.prisma.course.update({
      where: { id: courseId },
      data: {
        brief: parsed as object,
        title: parsed.title,
        language: parsed.language,
      },
    });
    return this.toView(course);
  }

  private async requireCourse(tenantId: string, courseId: string) {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, tenantId },
    });
    if (!course) throw new NotFoundException('Corso non trovato');
    return course;
  }

  /** Verifica che tutti i brand indicati esistano e appartengano al tenant. */
  private async assertBrandsExist(tenantId: string, brandIds?: string[]): Promise<void> {
    if (!brandIds || brandIds.length === 0) return;
    const count = await this.prisma.brand.count({
      where: { tenantId, id: { in: brandIds } },
    });
    if (count !== brandIds.length) {
      throw new BadRequestException('Uno o più brand indicati non esistono per il tenant');
    }
  }

  private async toView(course: {
    id: string;
    title: string;
    description: string;
    language: string;
    status: string;
    brief: unknown;
    coverImageKey?: string | null;
    coverAttribution?: unknown;
    interactionStyle?: string | null;
    primaryBrandId?: string | null;
    instructorName?: string | null;
    instructorRole?: string | null;
    instructorAvatarKey?: string | null;
    folderId?: string | null;
  }): Promise<CourseView> {
    const briefResult = course.brief ? BriefDraft.safeParse(course.brief) : null;
    let coverImageUrl: string | undefined;
    if (course.coverImageKey) {
      try {
        coverImageUrl = await this.storage.getSignedUrl(course.coverImageKey, {
          expiresInSec: COVER_URL_TTL_SEC,
        });
      } catch {
        // Copertina non risolvibile: semplicemente non viene mostrata.
      }
    }
    let instructor: CourseView['instructor'];
    if (course.instructorName) {
      let avatarUrl: string | undefined;
      if (course.instructorAvatarKey) {
        try {
          avatarUrl = await this.storage.getSignedUrl(course.instructorAvatarKey, {
            expiresInSec: COVER_URL_TTL_SEC,
          });
        } catch {
          // Foto non risolvibile: si mostra senza avatar.
        }
      }
      instructor = {
        name: course.instructorName,
        role: course.instructorRole ?? undefined,
        avatarUrl,
      };
    }
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      language: course.language,
      status: course.status,
      brief: briefResult && briefResult.success ? briefResult.data : null,
      coverImageUrl,
      coverAttribution: parseCoverAttribution(course.coverAttribution),
      interactionStyle: course.interactionStyle === 'lively' ? 'lively' : 'sober',
      primaryBrandId: course.primaryBrandId ?? undefined,
      instructor,
      folderId: course.folderId ?? null,
    };
  }
}

/** Legge l'attribuzione copertina (JSON) nel formato esposto dalla view. */
function parseCoverAttribution(
  raw: unknown,
): { provider: string; authorName: string; authorUrl?: string; sourceUrl?: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.provider !== 'string' || typeof o.authorName !== 'string') return undefined;
  return {
    provider: o.provider,
    authorName: o.authorName,
    ...(typeof o.authorUrl === 'string' ? { authorUrl: o.authorUrl } : {}),
    ...(typeof o.sourceUrl === 'string' ? { sourceUrl: o.sourceUrl } : {}),
  };
}

/** Estensione file per i MIME immagine supportati (null se non supportato). */
function extForImageMime(mime: string): string | null {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/svg+xml':
      return 'svg';
    default:
      return null;
  }
}
