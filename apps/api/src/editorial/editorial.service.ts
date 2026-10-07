import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { Block, CONTRACTS_VERSION, type Block as BlockType } from '@scorm/contracts';
import { sanitizeHtml } from '@scorm/scorm';
import type { EditorialStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

const BlockArray = z.array(Block);

/** Entità versionabili nel flusso editoriale. */
export type EntityType = 'course' | 'module' | 'lesson' | 'assessment';

export interface EditLessonBlocksInput {
  blocks: BlockType[];
  /** Token di concorrenza: updatedAt letto in precedenza (ISO string). */
  expectedUpdatedAt: string;
  authorId?: string;
}

/**
 * Editor human-in-the-loop (Requisito 8). Fornisce:
 *  - modifica dei contenuti con sanitizzazione dell'HTML (7.1 / 12.3);
 *  - stato editoriale draft/in_review/approved (8.2);
 *  - versioning immutabile con confronto e ripristino (8.5);
 *  - optimistic locking per evitare sovrascritture silenziose (8.6).
 */
@Injectable()
export class EditorialService {
  constructor(private readonly prisma: PrismaService) {}

  // --- 7.1 + 7.4: modifica contenuti con sanitizzazione e lock --------------

  /**
   * Aggiorna i block di una lezione. Sanifica l'HTML del rich-text, verifica il
   * token di concorrenza (optimistic lock) e salva uno snapshot della versione
   * precedente prima di sovrascrivere.
   */
  async editLessonBlocks(
    tenantId: string,
    courseId: string,
    lessonId: string,
    input: EditLessonBlocksInput,
  ) {
    const lesson = await this.requireLesson(tenantId, courseId, lessonId);
    this.assertNoConflict(lesson.updatedAt, input.expectedUpdatedAt);

    // Valida e sanifica i block in ingresso.
    const parsed = BlockArray.parse(input.blocks).map(sanitizeBlock);

    // Snapshot della versione corrente per il ripristino (8.5).
    await this.snapshot(courseId, 'lesson', lessonId, lesson.blocks, input.authorId);

    return this.prisma.lesson.update({
      where: { id: lessonId },
      data: { blocks: parsed as object, schemaVersion: CONTRACTS_VERSION },
    });
  }

  // --- 7.2: stato editoriale -----------------------------------------------

  /** Transizione di stato editoriale di un'entità (Requisito 8.2). */
  async setStatus(
    tenantId: string,
    courseId: string,
    entity: EntityType,
    entityId: string,
    status: EditorialStatus,
  ) {
    await this.requireCourse(tenantId, courseId);
    switch (entity) {
      case 'course':
        await this.ensureOwned(this.prisma.course.findFirst({ where: { id: entityId, tenantId } }));
        return this.prisma.course.update({ where: { id: entityId }, data: { status } });
      case 'module':
        await this.ensureOwned(this.prisma.module.findFirst({ where: { id: entityId, courseId } }));
        return this.prisma.module.update({ where: { id: entityId }, data: { status } });
      case 'lesson':
        await this.ensureOwned(
          this.prisma.lesson.findFirst({ where: { id: entityId, module: { courseId } } }),
        );
        return this.prisma.lesson.update({ where: { id: entityId }, data: { status } });
      case 'assessment':
        await this.ensureOwned(
          this.prisma.assessment.findFirst({ where: { id: entityId, courseId } }),
        );
        return this.prisma.assessment.update({ where: { id: entityId }, data: { status } });
      default:
        throw new BadRequestException('Tipo di entità non valido');
    }
  }

  // --- 7.2: versioning ------------------------------------------------------

  /** Elenca le versioni salvate di un'entità (più recenti prima). */
  async listVersions(tenantId: string, courseId: string, entity: EntityType, entityId: string) {
    await this.requireCourse(tenantId, courseId);
    return this.prisma.contentVersion.findMany({
      where: { courseId, entityType: entity, entityId },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, authorId: true, createdAt: true },
    });
  }

  /** Restituisce lo snapshot di una versione per il confronto. */
  async getVersion(tenantId: string, courseId: string, versionId: string) {
    await this.requireCourse(tenantId, courseId);
    const version = await this.prisma.contentVersion.findFirst({
      where: { id: versionId, courseId },
    });
    if (!version) throw new NotFoundException('Versione non trovata');
    return version;
  }

  /**
   * Ripristina una versione di una lezione: salva lo stato corrente come nuova
   * versione (così il ripristino è reversibile) e riporta lo snapshot.
   */
  async restoreLessonVersion(
    tenantId: string,
    courseId: string,
    lessonId: string,
    versionId: string,
    authorId?: string,
  ) {
    const lesson = await this.requireLesson(tenantId, courseId, lessonId);
    const version = await this.getVersion(tenantId, courseId, versionId);
    if (version.entityType !== 'lesson' || version.entityId !== lessonId) {
      throw new BadRequestException('La versione non appartiene a questa lezione');
    }
    await this.snapshot(courseId, 'lesson', lessonId, lesson.blocks, authorId);
    const restored = BlockArray.parse(version.snapshot);
    return this.prisma.lesson.update({
      where: { id: lessonId },
      data: { blocks: restored as object },
    });
  }

  // --- 7.3: supporto alla rigenerazione mirata -----------------------------

  /**
   * Salva uno snapshot della lezione prima di una rigenerazione, così la
   * versione precedente resta ripristinabile (Requisito 8.4 / 8.5).
   */
  async snapshotLessonBeforeRegeneration(
    tenantId: string,
    courseId: string,
    lessonId: string,
    authorId?: string,
  ): Promise<void> {
    const lesson = await this.requireLesson(tenantId, courseId, lessonId);
    await this.snapshot(courseId, 'lesson', lessonId, lesson.blocks, authorId);
  }

  // --- Helper ---------------------------------------------------------------

  /** Crea uno snapshot immutabile con numero di versione incrementale. */
  private async snapshot(
    courseId: string,
    entityType: EntityType,
    entityId: string,
    snapshot: unknown,
    authorId?: string,
  ): Promise<void> {
    const last = await this.prisma.contentVersion.findFirst({
      where: { entityType, entityId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    await this.prisma.contentVersion.create({
      data: {
        courseId,
        entityType,
        entityId,
        version: (last?.version ?? 0) + 1,
        snapshot: (snapshot ?? []) as object,
        authorId,
      },
    });
  }

  /** Optimistic lock: confronta updatedAt atteso e corrente (Requisito 8.6). */
  private assertNoConflict(current: Date, expectedIso: string): void {
    const expected = new Date(expectedIso).getTime();
    if (Number.isNaN(expected)) {
      throw new BadRequestException('expectedUpdatedAt non valido');
    }
    if (current.getTime() !== expected) {
      throw new ConflictException(
        'Il contenuto è stato modificato da un altro utente. Ricarica e riprova.',
      );
    }
  }

  private async requireCourse(tenantId: string, courseId: string) {
    const course = await this.prisma.course.findFirst({ where: { id: courseId, tenantId } });
    if (!course) throw new NotFoundException('Corso non trovato');
    return course;
  }

  private async requireLesson(tenantId: string, courseId: string, lessonId: string) {
    await this.requireCourse(tenantId, courseId);
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, module: { courseId } },
    });
    if (!lesson) throw new NotFoundException('Lezione non trovata');
    return lesson;
  }

  private async ensureOwned<T>(p: Promise<T | null>): Promise<T> {
    const row = await p;
    if (!row) throw new NotFoundException('Risorsa non trovata');
    return row;
  }
}

/**
 * Sanifica l'HTML dei campi rich-text di un Block prima del salvataggio
 * (Requisito 12.3). Attraversa i payload noti che contengono RichText.
 */
export function sanitizeBlock(block: BlockType): BlockType {
  const clone = structuredClone(block);
  const p = clone.payload as Record<string, unknown>;

  const sanitizeRich = (rt: unknown): void => {
    if (rt && typeof rt === 'object' && 'html' in rt) {
      const node = rt as { html: string };
      node.html = sanitizeHtml(node.html);
    }
  };

  switch (clone.type) {
    case 'rich_text':
      sanitizeRich((p as { content?: unknown }).content);
      break;
    case 'accordion_tabs':
      for (const panel of (p.panels as Array<{ content: unknown }>) ?? []) sanitizeRich(panel.content);
      break;
    case 'flashcard':
      for (const card of (p.cards as Array<{ front: unknown; back: unknown }>) ?? []) {
        sanitizeRich(card.front);
        sanitizeRich(card.back);
      }
      break;
    case 'timeline':
      for (const ev of (p.events as Array<{ content: unknown }>) ?? []) sanitizeRich(ev.content);
      break;
    case 'image_hotspot':
      for (const h of (p.hotspots as Array<{ content: unknown }>) ?? []) sanitizeRich(h.content);
      break;
    case 'click_reveal':
      for (const it of (p.items as Array<{ content: unknown }>) ?? []) sanitizeRich(it.content);
      break;
    case 'branching_scenario':
      for (const n of (p.nodes as Array<{ content: unknown }>) ?? []) sanitizeRich(n.content);
      break;
    case 'carousel_steps':
      for (const s of (p.steps as Array<{ content: unknown }>) ?? []) sanitizeRich(s.content);
      break;
    default:
      break;
  }
  return clone;
}
