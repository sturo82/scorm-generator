import { Inject, Injectable } from '@nestjs/common';
import type { DashboardCourse, DashboardSummary } from '@scorm/contracts';
import type { ObjectStorage } from '@scorm/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { OBJECT_STORAGE } from '../providers/provider.constants.js';

const COVER_URL_TTL_SEC = 6 * 3600;

interface MediaRow {
  courseId: string;
  videos: bigint | number;
  images: bigint | number;
  narrations: bigint | number;
}

/** Riepilogo della dashboard: una lettura sola per i numeri, copertine firmate per i corsi recenti. */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async summary(tenantId: string, userId: string, recentLimit = 6): Promise<DashboardSummary> {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    // Con una sola persona nella company non c'è nulla da dividere: tutto è "mio".
    const members = await this.prisma.user.count({ where: { tenantId } });
    const shared = members > 1;
    const mineWhere = shared ? { tenantId, createdById: userId } : { tenantId };
    const othersWhere = { tenantId, OR: [{ createdById: null }, { createdById: { not: userId } }] };
    const recentSelect = {
      id: true,
      title: true,
      description: true,
      language: true,
      status: true,
      coverImageKey: true,
      coverPosition: true,
      updatedAt: true,
      createdAt: true,
      autopilot: true,
      createdById: true,
      createdBy: { select: { displayName: true, email: true } },
      modules: { select: { lessons: { select: { blocks: true } } } },
    } as const;

    const [byStatus, brands, knowledgeDocs, libraryRows, media, month, total, recentMine, recentOthers, mineCount] = await Promise.all([
      this.prisma.course.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
      this.prisma.brand.count({ where: { tenantId } }),
      this.prisma.knowledgeDoc.count({ where: { tenantId } }),
      this.prisma.videoAsset.groupBy({ by: ['source'], where: { tenantId }, _count: { _all: true } }),
      // Video, immagini e narrazioni per corso: una sola scansione dei blocchi delle lezioni.
      this.prisma.$queryRaw<MediaRow[]>`
        SELECT m."courseId" AS "courseId",
          COALESCE(SUM((SELECT COUNT(*) FROM jsonb_path_query(l.blocks, 'lax $.** ? (@.kind == "video" && exists(@.storageKey))'))), 0) AS videos,
          COALESCE(SUM((SELECT COUNT(*) FROM jsonb_path_query(l.blocks, 'lax $.** ? (@.kind == "image" && exists(@.storageKey))'))), 0) AS images,
          COUNT(*) FILTER (WHERE l."narrationKey" IS NOT NULL) AS narrations
        FROM "Lesson" l
        JOIN "Module" m ON m.id = l."moduleId"
        JOIN "Course" c ON c.id = m."courseId"
        WHERE c."tenantId" = ${tenantId} AND jsonb_typeof(l.blocks) = 'array'
        GROUP BY m."courseId"`,
      this.prisma.creditCharge.aggregate({ where: { tenantId, createdAt: { gte: monthStart } }, _sum: { credits: true } }),
      this.prisma.creditCharge.aggregate({ where: { tenantId }, _sum: { credits: true } }),
      this.prisma.course.findMany({ where: mineWhere, orderBy: { updatedAt: 'desc' }, take: recentLimit, select: recentSelect }),
      shared
        ? this.prisma.course.findMany({ where: othersWhere, orderBy: { updatedAt: 'desc' }, take: recentLimit, select: recentSelect })
        : Promise.resolve([]),
      this.prisma.course.count({ where: mineWhere }),
    ]);

    const n = (v: bigint | number) => Number(v);
    const mediaBy = new Map(media.map((r) => [r.courseId, r]));
    const count = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
    const lib = (s: string) => libraryRows.find((r) => r.source === s)?._count._all ?? 0;
    const uploaded = lib('UPLOAD');
    const external = lib('YOUTUBE') + lib('VIMEO') + lib('TWITCH');
    const fromSlides = await this.prisma.videoAsset.count({ where: { tenantId, slideImportId: { not: null } } });

    // Lezioni totali e pronte di tutto il tenant (per la barra di avanzamento generale).
    const lessonAgg = await this.prisma.$queryRaw<Array<{ total: bigint; ready: bigint }>>`
      SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE jsonb_typeof(l.blocks) = 'array' AND jsonb_array_length(l.blocks) > 0) AS ready
      FROM "Lesson" l JOIN "Module" m ON m.id = l."moduleId" JOIN "Course" c ON c.id = m."courseId"
      WHERE c."tenantId" = ${tenantId}`;

    const recent = [...recentMine, ...recentOthers];
    const recentIds = recent.map((c) => c.id);
    const spent = recentIds.length
      ? await this.prisma.creditCharge.groupBy({ by: ['courseId'], where: { tenantId, courseId: { in: recentIds } }, _sum: { credits: true } })
      : [];
    const spentBy = new Map(spent.map((r) => [r.courseId, r._sum.credits ?? 0]));

    const recentCourses: DashboardCourse[] = await Promise.all(
      recent.map(async (c) => {
        const lessons = c.modules.flatMap((m) => m.lessons);
        const ap = c.autopilot as { status?: string; issues?: unknown[] } | null;
        const row = mediaBy.get(c.id);
        let coverImageUrl: string | undefined;
        if (c.coverImageKey) {
          coverImageUrl = await this.storage.getSignedUrl(c.coverImageKey, { expiresInSec: COVER_URL_TTL_SEC }).catch(() => undefined);
        }
        return {
          id: c.id,
          title: c.title,
          description: c.description ?? '',
          language: c.language,
          status: c.status,
          ...(coverImageUrl ? { coverImageUrl } : {}),
          coverPosition: c.coverPosition,
          updatedAt: c.updatedAt.toISOString(),
          createdAt: c.createdAt.toISOString(),
          modules: c.modules.length,
          lessons: lessons.length,
          lessonsReady: lessons.filter((l) => Array.isArray(l.blocks) && (l.blocks as unknown[]).length > 0).length,
          videos: row ? n(row.videos) : 0,
          generating: ap?.status === 'running' || ap?.status === 'paused',
          needsAttention: ap?.status === 'failed' || ap?.status === 'cancelled' || (ap?.status === 'completed' && (ap.issues?.length ?? 0) > 0),
          credits: spentBy.get(c.id) ?? 0,
          mine: !shared || c.createdById === userId,
          ...(c.createdBy ? { createdByName: c.createdBy.displayName?.trim() || c.createdBy.email } : {}),
        };
      }),
    );

    return {
      totals: {
        courses: byStatus.reduce((t, r) => t + r._count._all, 0),
        byStatus: { draft: count('DRAFT'), inReview: count('IN_REVIEW'), approved: count('APPROVED') },
        lessons: n(lessonAgg[0]?.total ?? 0),
        lessonsReady: n(lessonAgg[0]?.ready ?? 0),
        brands,
        knowledgeDocs,
      },
      media: {
        lessonVideos: media.reduce((t, r) => t + n(r.videos), 0),
        library: { total: libraryRows.reduce((t, r) => t + r._count._all, 0), uploaded, fromSlides, external },
        images: media.reduce((t, r) => t + n(r.images), 0),
        narrations: media.reduce((t, r) => t + n(r.narrations), 0),
      },
      credits: { spentThisMonth: month._sum.credits ?? 0, spentTotal: total._sum.credits ?? 0 },
      recentCourses,
      courseOwners: {
        mine: mineCount,
        company: shared ? byStatus.reduce((t, r) => t + r._count._all, 0) - mineCount : 0,
        shared,
      },
    };
  }
}
