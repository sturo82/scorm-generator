import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OBJECT_STORAGE } from '../providers/provider.constants.js';
import type { ObjectStorage } from '@scorm/domain';
import { ExportService } from '../export/export.service.js';
import type { ScormProfile as PrismaScormProfile } from '@prisma/client';

/** TTL (secondi) degli URL firmati esposti al catalogo. */
const COVER_URL_TTL_SEC = 3600;
const DOWNLOAD_URL_TTL_SEC = 600;

/** Metadati di un corso esposto al catalogo di integrazione. */
export interface CatalogCourseView {
  id: string;
  title: string;
  description: string;
  language: string;
  coverImageUrl?: string;
  updatedAt: string;
  /** Versioni di pacchetto SCORM già pronte (per profilo/brand). */
  availablePackages: CatalogPackageView[];
}

/** Un pacchetto SCORM già costruito e scaricabile. */
export interface CatalogPackageView {
  packageId: string;
  version: number;
  profile: PrismaScormProfile;
  brandId: string;
  sizeBytes: number | null;
  createdAt: string;
}

/** Esito di una richiesta di download. */
export interface CatalogDownloadResult {
  courseId: string;
  packageId: string;
  version: number;
  profile: PrismaScormProfile;
  downloadUrl: string;
  expiresInSec: number;
  sizeBytes: number | null;
}

/**
 * Catalogo dei corsi condivisibili per le integrazioni B2B. Espone SOLO i corsi
 * con `shareable = true` E stato editoriale `APPROVED`: l'opt-in del tenant più
 * l'approvazione editoriale sono entrambi necessari. Tutte le query sono
 * tenant-scoped (il tenant arriva dal token di servizio).
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exportService: ExportService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** Elenca i corsi condivisibili del tenant con le loro versioni pronte. */
  async listCourses(tenantId: string): Promise<CatalogCourseView[]> {
    const courses = await this.prisma.course.findMany({
      where: { tenantId, shareable: true, status: 'APPROVED' },
      orderBy: { updatedAt: 'desc' },
      include: {
        builds: {
          include: {
            packages: {
              where: { status: 'READY' },
              orderBy: { version: 'desc' },
            },
          },
        },
      },
    });
    return Promise.all(courses.map((c) => this.toCatalogView(c)));
  }

  /** Dettaglio di un singolo corso condivisibile. */
  async getCourse(tenantId: string, courseId: string): Promise<CatalogCourseView> {
    const course = await this.requireShareableCourse(tenantId, courseId, {
      builds: {
        include: {
          packages: { where: { status: 'READY' }, orderBy: { version: 'desc' } },
        },
      },
    });
    return this.toCatalogView(course);
  }

  /** Solo le versioni di pacchetto pronte di un corso. */
  async listPackages(tenantId: string, courseId: string): Promise<CatalogPackageView[]> {
    const view = await this.getCourse(tenantId, courseId);
    return view.availablePackages;
  }

  /**
   * Produce un URL di download firmato per il pacchetto SCORM del corso.
   * Se esiste già un pacchetto READY per il brand primario del corso, ne firma
   * la chiave esistente; altrimenti costruisce un nuovo export (riusa la logica
   * di ExportService, che versiona e salva su storage). `allowUnapproved` è
   * false: il corso DEVE essere APPROVED per stare nel catalogo.
   */
  async download(
    tenantId: string,
    courseId: string,
    opts: { profile?: PrismaScormProfile; brandId?: string } = {},
  ): Promise<CatalogDownloadResult> {
    const course = await this.requireShareableCourse(tenantId, courseId, {
      builds: { include: { packages: { where: { status: 'READY' }, orderBy: { version: 'desc' } } } },
    });

    const profile: PrismaScormProfile = opts.profile ?? 'SCORM_2004_4TH';
    const brandId = opts.brandId ?? course.primaryBrandId ?? undefined;

    // Cerca un pacchetto READY già costruito per (brand?, profilo).
    const existing = this.findReadyPackage(course, profile, brandId);
    if (existing && existing.pkg.storageKey) {
      const downloadUrl = await this.storage.getSignedUrl(existing.pkg.storageKey, {
        expiresInSec: DOWNLOAD_URL_TTL_SEC,
        downloadFilename: `${slug(course.title)}-scorm.zip`,
      });
      return {
        courseId,
        packageId: existing.pkg.id,
        version: existing.pkg.version,
        profile,
        downloadUrl,
        expiresInSec: DOWNLOAD_URL_TTL_SEC,
        sizeBytes: existing.pkg.sizeBytes,
      };
    }

    // Nessun pacchetto pronto: costruiscilo adesso (riusa ExportService).
    const result = await this.exportService.exportCourse({
      tenantId,
      courseId,
      brandId,
      profile,
      allowUnapproved: false,
    });
    return {
      courseId,
      packageId: result.packageId,
      version: result.version,
      profile,
      downloadUrl: result.downloadUrl,
      expiresInSec: DOWNLOAD_URL_TTL_SEC,
      sizeBytes: result.sizeBytes,
    };
  }

  private findReadyPackage(
    course: CourseWithBuilds,
    profile: PrismaScormProfile,
    brandId?: string,
  ): { pkg: PackageRow } | null {
    for (const build of course.builds) {
      if (build.profile !== profile) continue;
      if (brandId && build.brandId !== brandId) continue;
      const pkg = build.packages[0]; // già ordinati per version desc
      if (pkg) return { pkg };
    }
    return null;
  }

  private async requireShareableCourse(
    tenantId: string,
    courseId: string,
    include: Record<string, unknown>,
  ): Promise<CourseWithBuilds> {
    const course = (await this.prisma.course.findFirst({
      where: { id: courseId, tenantId, shareable: true, status: 'APPROVED' },
      include: include as never,
    })) as CourseWithBuilds | null;
    if (!course) {
      throw new NotFoundException('Corso non disponibile nel catalogo');
    }
    return course;
  }

  private async toCatalogView(course: CourseWithBuilds): Promise<CatalogCourseView> {
    let coverImageUrl: string | undefined;
    if (course.coverImageKey) {
      try {
        coverImageUrl = await this.storage.getSignedUrl(course.coverImageKey, {
          expiresInSec: COVER_URL_TTL_SEC,
        });
      } catch {
        // Copertina non risolvibile: si omette.
      }
    }
    const availablePackages: CatalogPackageView[] = [];
    for (const build of course.builds ?? []) {
      for (const pkg of build.packages ?? []) {
        availablePackages.push({
          packageId: pkg.id,
          version: pkg.version,
          profile: build.profile,
          brandId: build.brandId,
          sizeBytes: pkg.sizeBytes,
          createdAt: pkg.createdAt.toISOString(),
        });
      }
    }
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      language: course.language,
      coverImageUrl,
      updatedAt: course.updatedAt.toISOString(),
      availablePackages,
    };
  }
}

interface PackageRow {
  id: string;
  version: number;
  status: string;
  storageKey: string | null;
  sizeBytes: number | null;
  createdAt: Date;
}

interface BuildRow {
  brandId: string;
  profile: PrismaScormProfile;
  packages: PackageRow[];
}

interface CourseWithBuilds {
  id: string;
  title: string;
  description: string;
  language: string;
  coverImageKey: string | null;
  primaryBrandId: string | null;
  updatedAt: Date;
  builds: BuildRow[];
}

/** Slug minimale per il nome file di download. */
function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
