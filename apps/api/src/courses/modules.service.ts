import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import {
  Block,
  Question,
  CourseOutline,
  CONTRACTS_VERSION,
  type Block as BlockType,
  type Question as QuestionType,
} from '@scorm/contracts';
import type { ObjectStorage } from '@scorm/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { OBJECT_STORAGE } from '../providers/provider.constants.js';

/** TTL dell'URL firmato per i media in anteprima. */
const PREVIEW_URL_TTL_SEC = 6 * 3600;

/** Schema per la lista di block di una lezione (validazione JSONB). */
export const BlockArray = z.array(Block);
/** Schema per la lista di objectives. */
export const ObjectivesArray = z.array(z.string());

export interface CreateModuleInput {
  title: string;
  summary?: string;
}

export interface CreateLessonInput {
  title: string;
}

/**
 * Gestione della gerarchia di contenuti del corso (Requisito 4.2): moduli,
 * lezioni (con block tipizzati) e assessment (con question tipizzate). I payload
 * ricchi sono validati con gli schema Zod dei contratti prima di essere salvati
 * come JSONB.
 */
@Injectable()
export class ModulesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  // --- Moduli ---------------------------------------------------------------

  async addModule(tenantId: string, courseId: string, input: CreateModuleInput) {
    await this.requireCourse(tenantId, courseId);
    const position = await this.prisma.module.count({ where: { courseId } });
    return this.prisma.module.create({
      data: { courseId, title: input.title, summary: input.summary, position },
    });
  }

  async listModules(tenantId: string, courseId: string) {
    await this.requireCourse(tenantId, courseId);
    const modules = await this.prisma.module.findMany({
      where: { courseId },
      orderBy: { position: 'asc' },
      include: { lessons: { orderBy: { position: 'asc' } } },
    });
    // Risolve gli storageKey dei media (chiavi S3) in URL firmati per
    // l'anteprima nel browser. La persistenza mantiene le chiavi; l'export le
    // usa per includere i file nel pacchetto.
    for (const m of modules) {
      // Copertina del modulo (se presente): risolve in URL firmato.
      const modAny = m as typeof m & { coverImageUrl?: string };
      if (m.coverImageKey) {
        try {
          modAny.coverImageUrl = await this.storage.getSignedUrl(m.coverImageKey, { expiresInSec: PREVIEW_URL_TTL_SEC });
        } catch { /* copertina non risolvibile */ }
      }
      for (const l of m.lessons) {
        if (Array.isArray(l.blocks)) {
          await this.signMediaUrls(l.blocks as unknown[]);
        }
        // Risolve la narrazione audio (chiave S3) in URL firmato per il player.
        const lessonWithAudio = l as typeof l & { narrationKey?: string | null; narrationUrl?: string };
        if (lessonWithAudio.narrationKey) {
          try {
            lessonWithAudio.narrationUrl = await this.storage.getSignedUrl(
              lessonWithAudio.narrationKey,
              { expiresInSec: PREVIEW_URL_TTL_SEC },
            );
          } catch {
            // Narrazione non risolvibile: il player semplicemente non comparirà.
          }
        }
      }
    }
    return modules;
  }

  /** Sostituisce (in-place, solo nella vista) le chiavi S3 dei media con URL firmati. */
  private async signMediaUrls(blocks: unknown[]): Promise<void> {
    const refs: Array<Record<string, unknown>> = [];
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (node === null || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (typeof obj.storageKey === 'string' && obj.storageKey && !obj.storageKey.startsWith('http')) {
        refs.push(obj);
      }
      for (const v of Object.values(obj)) visit(v);
    };
    visit(blocks);
    await Promise.all(
      refs.map(async (ref) => {
        try {
          ref.storageKey = await this.storage.getSignedUrl(ref.storageKey as string, {
            expiresInSec: PREVIEW_URL_TTL_SEC,
          });
        } catch {
          // Se la firma fallisce, lascia la chiave: l'anteprima mostrerà il placeholder.
        }
      }),
    );
  }

  /**
   * Elimina un modulo (e, per cascade, le sue lezioni) e ricompatta le position
   * dei moduli rimanenti del corso, così da non lasciare buchi.
   */
  async deleteModule(tenantId: string, courseId: string, moduleId: string) {
    await this.requireModule(tenantId, courseId, moduleId);
    await this.prisma.$transaction(async (tx) => {
      await tx.module.delete({ where: { id: moduleId } });
      const remaining = await tx.module.findMany({
        where: { courseId },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      await Promise.all(
        remaining.map((m, index) =>
          tx.module.update({ where: { id: m.id }, data: { position: index } }),
        ),
      );
    });
    return { deleted: true };
  }

  /**
   * Elimina una lezione e ricompatta le position delle lezioni rimanenti nel
   * modulo. (La cancellazione dei block avviene con la lezione stessa.)
   */
  async deleteLesson(tenantId: string, courseId: string, moduleId: string, lessonId: string) {
    await this.requireLesson(tenantId, courseId, moduleId, lessonId);
    await this.prisma.$transaction(async (tx) => {
      await tx.lesson.delete({ where: { id: lessonId } });
      const remaining = await tx.lesson.findMany({
        where: { moduleId },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      await Promise.all(
        remaining.map((l, index) =>
          tx.lesson.update({ where: { id: l.id }, data: { position: index } }),
        ),
      );
    });
    return { deleted: true };
  }

  /**
   * Materializza l'outline (generato dall'AI) nelle entità Module/Lesson,
   * RICONCILIANDO la struttura con l'outline corrente (Requisito 4.1 -> 4.2):
   *  - crea moduli/lezioni presenti nell'outline ma non ancora nel DB;
   *  - allinea posizioni e summary/obiettivi all'outline;
   *  - rimuove moduli/lezioni non più presenti nell'outline SOLO se "vuoti"
   *    (lezioni senza block; moduli le cui lezioni sono tutte senza block), così
   *    una rigenerazione dell'outline non lascia duplicati orfani.
   * Non elimina MAI contenuti già prodotti: le lezioni con block vengono
   * preservate anche se non più nell'outline (vanno rimosse manualmente). Il
   * match è per titolo normalizzato (case/spazi), più robusto del match esatto.
   * Restituisce la gerarchia aggiornata.
   */
  async materializeOutline(tenantId: string, courseId: string) {
    const course = await this.requireCourse(tenantId, courseId);
    const parsed = course.outline ? CourseOutline.safeParse(course.outline) : null;
    if (!parsed || !parsed.success) {
      throw new BadRequestException(
        "Il corso non ha un outline valido da materializzare: genera prima l'outline",
      );
    }
    // Corso video-first: ogni lezione eredita il flag; altrimenti vale il flag
    // per-lezione dall'outline.
    const courseVideoFirst =
      !!(course.brief && (course.brief as { videoFirst?: boolean }).videoFirst);

    const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');
    const hasBlocks = (blocks: unknown): boolean =>
      Array.isArray(blocks) && blocks.length > 0;

    await this.prisma.$transaction(async (tx) => {
      const existingModules = await tx.module.findMany({
        where: { courseId },
        orderBy: { position: 'asc' },
        include: { lessons: true },
      });
      const moduleByTitle = new Map(existingModules.map((m) => [norm(m.title), m]));
      const outlineModuleKeys = new Set(parsed.data.modules.map((m) => norm(m.title)));

      // Riconcilia i moduli dell'outline, nell'ordine dell'outline.
      for (let mi = 0; mi < parsed.data.modules.length; mi++) {
        const mo = parsed.data.modules[mi]!;
        let moduleRow = moduleByTitle.get(norm(mo.title));
        if (!moduleRow) {
          moduleRow = await tx.module.create({
            data: { courseId, title: mo.title, summary: mo.summary, position: mi },
            include: { lessons: true },
          });
          moduleByTitle.set(norm(mo.title), moduleRow);
        } else if (moduleRow.position !== mi || (mo.summary ?? null) !== (moduleRow.summary ?? null)) {
          // Allinea posizione e summary all'outline.
          await tx.module.update({
            where: { id: moduleRow.id },
            data: { position: mi, summary: mo.summary },
          });
        }

        const lessonByTitle = new Map(moduleRow.lessons.map((l) => [norm(l.title), l]));
        const outlineLessonKeys = new Set(mo.lessons.map((l) => norm(l.title)));

        for (let li = 0; li < mo.lessons.length; li++) {
          const lo = mo.lessons[li]!;
          const lessonRow = lessonByTitle.get(norm(lo.title));
          const videoFirst = courseVideoFirst || lo.videoFirst === true;
          if (!lessonRow) {
            await tx.lesson.create({
              data: {
                moduleId: moduleRow.id,
                title: lo.title,
                position: li,
                objectives: lo.objectives as object,
                videoFirst,
              },
            });
          } else if (lessonRow.position !== li || lessonRow.videoFirst !== videoFirst) {
            await tx.lesson.update({
              where: { id: lessonRow.id },
              data: { position: li, videoFirst },
            });
          }
        }

        // Rimuove le lezioni non più nell'outline SOLO se senza contenuti.
        for (const l of moduleRow.lessons) {
          if (!outlineLessonKeys.has(norm(l.title)) && !hasBlocks(l.blocks)) {
            await tx.lesson.delete({ where: { id: l.id } });
          }
        }
      }

      // Rimuove i moduli non più nell'outline, SOLO se nessuna loro lezione ha
      // contenuti (altrimenti si preserva il lavoro già prodotto).
      for (const m of existingModules) {
        if (outlineModuleKeys.has(norm(m.title))) continue;
        const anyContent = m.lessons.some((l) => hasBlocks(l.blocks));
        if (!anyContent) {
          await tx.module.delete({ where: { id: m.id } });
        }
      }
    });

    return this.listModules(tenantId, courseId);
  }

  // --- Lezioni --------------------------------------------------------------

  async addLesson(tenantId: string, courseId: string, moduleId: string, input: CreateLessonInput) {
    await this.requireModule(tenantId, courseId, moduleId);
    const position = await this.prisma.lesson.count({ where: { moduleId } });
    return this.prisma.lesson.create({
      data: { moduleId, title: input.title, position },
    });
  }

  /** Imposta i block (interazioni) di una lezione, validandoli per schema. */
  async setLessonBlocks(
    tenantId: string,
    courseId: string,
    moduleId: string,
    lessonId: string,
    blocks: BlockType[],
  ) {
    await this.requireLesson(tenantId, courseId, moduleId, lessonId);
    const parsed = BlockArray.parse(blocks);
    return this.prisma.lesson.update({
      where: { id: lessonId },
      data: { blocks: parsed as object, schemaVersion: CONTRACTS_VERSION },
    });
  }

  async setLessonObjectives(
    tenantId: string,
    courseId: string,
    moduleId: string,
    lessonId: string,
    objectives: string[],
  ) {
    await this.requireLesson(tenantId, courseId, moduleId, lessonId);
    const parsed = ObjectivesArray.parse(objectives);
    return this.prisma.lesson.update({
      where: { id: lessonId },
      data: { objectives: parsed as object },
    });
  }

  /** Marca/smarca una lezione come video-first (incentrata su un video). */
  async setLessonVideoFirst(
    tenantId: string,
    courseId: string,
    moduleId: string,
    lessonId: string,
    videoFirst: boolean,
  ) {
    await this.requireLesson(tenantId, courseId, moduleId, lessonId);
    return this.prisma.lesson.update({
      where: { id: lessonId },
      data: { videoFirst },
    });
  }

  // --- Assessment e domande -------------------------------------------------

  /**
   * Elenco leggero degli assessment del corso per l'ANTEPRIMA: solo i campi che
   * servono all'indice/sequenza (id, titolo, scope minuscolo coerente con
   * buildCourseSteps, moduleId). Nessuna domanda (non serve all'indice).
   */
  async listAssessments(tenantId: string, courseId: string) {
    await this.requireCourse(tenantId, courseId);
    const rows = await this.prisma.assessment.findMany({
      where: { courseId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true, scope: true, moduleId: true },
    });
    return rows.map((a) => ({
      id: a.id,
      title: a.title,
      scope: a.scope === 'FINAL' ? ('final' as const) : ('intermediate' as const),
      moduleId: a.moduleId ?? undefined,
    }));
  }

  async addAssessment(
    tenantId: string,
    courseId: string,
    input: { title: string; scope: 'INTERMEDIATE' | 'FINAL'; moduleId?: string },
  ) {
    await this.requireCourse(tenantId, courseId);
    return this.prisma.assessment.create({
      data: {
        courseId,
        title: input.title,
        scope: input.scope,
        moduleId: input.moduleId,
      },
    });
  }

  /** Aggiunge una domanda tipizzata a un assessment, validandola per schema. */
  async addQuestion(
    tenantId: string,
    courseId: string,
    assessmentId: string,
    question: QuestionType,
  ) {
    await this.requireAssessment(tenantId, courseId, assessmentId);
    const parsed = Question.parse(question);
    const position = await this.prisma.question.count({ where: { assessmentId } });
    return this.prisma.question.create({
      data: {
        assessmentId,
        type: parsed.type,
        position,
        points: parsed.points,
        payload: parsed as object,
        schemaVersion: CONTRACTS_VERSION,
      },
    });
  }

  // --- Guardie di appartenenza ---------------------------------------------

  private async requireCourse(tenantId: string, courseId: string) {
    const course = await this.prisma.course.findFirst({ where: { id: courseId, tenantId } });
    if (!course) throw new NotFoundException('Corso non trovato');
    return course;
  }

  private async requireModule(tenantId: string, courseId: string, moduleId: string) {
    await this.requireCourse(tenantId, courseId);
    const module = await this.prisma.module.findFirst({ where: { id: moduleId, courseId } });
    if (!module) throw new NotFoundException('Modulo non trovato');
    return module;
  }

  private async requireLesson(
    tenantId: string,
    courseId: string,
    moduleId: string,
    lessonId: string,
  ) {
    await this.requireModule(tenantId, courseId, moduleId);
    const lesson = await this.prisma.lesson.findFirst({ where: { id: lessonId, moduleId } });
    if (!lesson) throw new NotFoundException('Lezione non trovata');
    return lesson;
  }

  private async requireAssessment(tenantId: string, courseId: string, assessmentId: string) {
    await this.requireCourse(tenantId, courseId);
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, courseId },
    });
    if (!assessment) throw new NotFoundException('Assessment non trovato');
    return assessment;
  }
}
