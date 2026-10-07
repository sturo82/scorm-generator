import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateFolder, FolderView, UpdateFolder } from '@scorm/contracts';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Gestione delle cartelle di organizzazione dei corsi (annidabili). Isolamento
 * per tenant esplicito su ogni query. Previene i cicli (una cartella non può
 * diventare discendente di sé stessa) e l'unicità del nome per livello.
 */
@Injectable()
export class FoldersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Elenco piatto delle cartelle del tenant con conteggio corsi diretti. */
  async list(tenantId: string): Promise<FolderView[]> {
    const folders = await this.prisma.folder.findMany({
      where: { tenantId },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { courses: true } } },
    });
    return folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      position: f.position,
      courseCount: f._count.courses,
    }));
  }

  async create(tenantId: string, input: CreateFolder): Promise<FolderView> {
    const parentId = input.parentId ?? null;
    if (parentId) await this.requireFolder(tenantId, parentId);
    await this.assertNameFree(tenantId, parentId, input.name);
    // Posizione in coda tra i pari livello.
    const siblings = await this.prisma.folder.count({ where: { tenantId, parentId } });
    try {
      const folder = await this.prisma.folder.create({
        data: { tenantId, name: input.name, parentId, position: siblings },
        include: { _count: { select: { courses: true } } },
      });
      return this.toView(folder);
    } catch {
      // Collisione unique concorrente.
      throw new BadRequestException('Esiste già una cartella con questo nome in questa posizione');
    }
  }

  async update(tenantId: string, folderId: string, input: UpdateFolder): Promise<FolderView> {
    const folder = await this.requireFolder(tenantId, folderId);
    const nextParentId =
      input.parentId === undefined ? folder.parentId : input.parentId;
    const nextName = input.name ?? folder.name;

    if (input.parentId !== undefined && nextParentId !== folder.parentId) {
      if (nextParentId) {
        if (nextParentId === folderId) {
          throw new BadRequestException('Una cartella non può essere spostata dentro sé stessa');
        }
        await this.requireFolder(tenantId, nextParentId);
        // Evita cicli: il nuovo padre non può essere un discendente di questa.
        if (await this.isDescendant(tenantId, folderId, nextParentId)) {
          throw new BadRequestException(
            'Spostamento non valido: creerebbe un ciclo nelle cartelle',
          );
        }
      }
    }

    // Unicità del nome nel livello di destinazione (escludendo sé stessa).
    if (nextName !== folder.name || nextParentId !== folder.parentId) {
      await this.assertNameFree(tenantId, nextParentId, nextName, folderId);
    }

    const updated = await this.prisma.folder.update({
      where: { id: folderId },
      data: { name: nextName, parentId: nextParentId },
      include: { _count: { select: { courses: true } } },
    });
    return this.toView(updated);
  }

  /**
   * Elimina una cartella. I corsi contenuti e le sottocartelle NON vengono
   * cancellati: risalgono alla radice (SetNull a livello DB). Scelta sicura:
   * nessuna perdita di contenuti per un'operazione di organizzazione.
   */
  async delete(tenantId: string, folderId: string): Promise<void> {
    await this.requireFolder(tenantId, folderId);
    await this.prisma.folder.delete({ where: { id: folderId } });
  }

  /** Sposta un corso in una cartella (o in radice con null). */
  async moveCourse(tenantId: string, courseId: string, folderId: string | null): Promise<void> {
    const course = await this.prisma.course.findFirst({ where: { id: courseId, tenantId } });
    if (!course) throw new NotFoundException('Corso non trovato');
    if (folderId) await this.requireFolder(tenantId, folderId);
    await this.prisma.course.update({ where: { id: courseId }, data: { folderId } });
  }

  private toView(f: {
    id: string;
    name: string;
    parentId: string | null;
    position: number;
    _count: { courses: number };
  }): FolderView {
    return {
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      position: f.position,
      courseCount: f._count.courses,
    };
  }

  private async requireFolder(tenantId: string, folderId: string) {
    const folder = await this.prisma.folder.findFirst({ where: { id: folderId, tenantId } });
    if (!folder) throw new NotFoundException('Cartella non trovata');
    return folder;
  }

  /** True se `candidateAncestorId` è `folderId` o un suo discendente. */
  private async isDescendant(
    tenantId: string,
    folderId: string,
    candidateAncestorId: string,
  ): Promise<boolean> {
    // Risale dalla candidata verso la radice: se incontra folderId, è un suo
    // discendente. Limite di profondità difensivo contro dati corrotti.
    let current: string | null = candidateAncestorId;
    for (let depth = 0; current && depth < 100; depth++) {
      if (current === folderId) return true;
      const parent: { parentId: string | null } | null = await this.prisma.folder.findFirst({
        where: { id: current, tenantId },
        select: { parentId: true },
      });
      current = parent?.parentId ?? null;
    }
    return false;
  }

  /** Garantisce che il nome sia libero nel livello (tenant, parent). */
  private async assertNameFree(
    tenantId: string,
    parentId: string | null,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.prisma.folder.findFirst({
      where: { tenantId, parentId, name, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('Esiste già una cartella con questo nome in questa posizione');
    }
  }
}
