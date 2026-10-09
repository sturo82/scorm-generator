import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service.js';

function makeStorage() {
  return {
    getSignedUrl: vi.fn(async (key: string) => `https://signed.example/${key}`),
  };
}

const course = {
  id: 'course-1',
  tenantId: 'tenant-1',
  title: 'Sicurezza sul lavoro',
  description: 'Corso base',
  language: 'it',
  status: 'APPROVED',
  shareable: true,
  coverImageKey: 'covers/c1.jpg',
  primaryBrandId: 'brand-1',
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  builds: [
    {
      brandId: 'brand-1',
      profile: 'SCORM_2004_4TH',
      packages: [
        {
          id: 'pkg-2',
          version: 2,
          status: 'READY',
          storageKey: 'packages/tenant-1/course-1/build-1/v2.zip',
          sizeBytes: 1234,
          createdAt: new Date('2026-01-02T00:00:00Z'),
        },
      ],
    },
  ],
};

function makePrisma(found: unknown) {
  return {
    course: {
      findMany: vi.fn(async () => (found ? [found] : [])),
      findFirst: vi.fn(async () => found ?? null),
    },
  };
}

describe('CatalogService', () => {
  it('elenca i corsi condivisibili con le versioni pronte e la copertina firmata', async () => {
    const prisma = makePrisma(course);
    const storage = makeStorage();
    const svc = new CatalogService(prisma as never, {} as never, storage as never);
    const list = await svc.listCourses('tenant-1');
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Sicurezza sul lavoro');
    expect(list[0].coverImageUrl).toContain('covers/c1.jpg');
    expect(list[0].availablePackages).toHaveLength(1);
    expect(list[0].availablePackages[0].version).toBe(2);
    // La query filtra shareable + APPROVED.
    expect(prisma.course.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ shareable: true, status: 'APPROVED' }),
      }),
    );
  });

  it('404 se il corso non è condivisibile/approvato', async () => {
    const prisma = makePrisma(null);
    const svc = new CatalogService(prisma as never, {} as never, makeStorage() as never);
    await expect(svc.getCourse('tenant-1', 'course-x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('download firma la chiave del pacchetto READY esistente senza ricostruire', async () => {
    const prisma = makePrisma(course);
    const storage = makeStorage();
    const exportService = { exportCourse: vi.fn() };
    const svc = new CatalogService(prisma as never, exportService as never, storage as never);
    const res = await svc.download('tenant-1', 'course-1', { profile: 'SCORM_2004_4TH' });
    expect(res.version).toBe(2);
    expect(res.downloadUrl).toContain('v2.zip');
    expect(storage.getSignedUrl).toHaveBeenCalled();
    // Non deve ricostruire: esiste già un pacchetto pronto.
    expect(exportService.exportCourse).not.toHaveBeenCalled();
  });

  it('download costruisce un nuovo pacchetto se non esiste pronto', async () => {
    const noPkg = { ...course, builds: [] };
    const prisma = makePrisma(noPkg);
    const storage = makeStorage();
    const exportService = {
      exportCourse: vi.fn(async () => ({
        packageId: 'pkg-new',
        version: 1,
        downloadUrl: 'https://signed.example/new.zip',
        sizeBytes: 999,
        warnings: [],
      })),
    };
    const svc = new CatalogService(prisma as never, exportService as never, storage as never);
    const res = await svc.download('tenant-1', 'course-1', {});
    expect(exportService.exportCourse).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', courseId: 'course-1', allowUnapproved: false }),
    );
    expect(res.packageId).toBe('pkg-new');
  });
});
