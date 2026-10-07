import { describe, it, expect } from 'vitest';
import { ModulesService } from './modules.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Verifica la materializzazione dell'outline e le cancellazioni con
 * ricompattazione delle position, usando un Prisma in-memory. Non tocca un DB
 * reale: simula le sole operazioni usate dal service.
 */

interface ModuleRow {
  id: string;
  courseId: string;
  title: string;
  summary?: string | null;
  position: number;
}
interface LessonRow {
  id: string;
  moduleId: string;
  title: string;
  position: number;
  objectives?: unknown;
}

function makeFakePrisma(seed: {
  course: Record<string, unknown> | null;
  modules?: ModuleRow[];
  lessons?: LessonRow[];
}) {
  let modules = [...(seed.modules ?? [])];
  let lessons = [...(seed.lessons ?? [])];
  let idSeq = 1000;
  const nextId = () => `gen-${idSeq++}`;

  const moduleApi = {
    findFirst: async ({ where }: any) =>
      modules.find((m) => m.id === where.id && m.courseId === where.courseId) ?? null,
    findMany: async ({ where, include }: any) => {
      const rows = modules
        .filter((m) => m.courseId === where.courseId)
        .sort((a, b) => a.position - b.position);
      if (include?.lessons) {
        return rows.map((m) => ({ ...m, lessons: lessons.filter((l) => l.moduleId === m.id) }));
      }
      return rows.map((m) => ({ ...m }));
    },
    create: async ({ data, include }: any) => {
      const row: ModuleRow = { id: nextId(), ...data };
      modules.push(row);
      return include?.lessons ? { ...row, lessons: [] } : { ...row };
    },
    update: async ({ where, data }: any) => {
      const m = modules.find((x) => x.id === where.id)!;
      Object.assign(m, data);
      return { ...m };
    },
    delete: async ({ where }: any) => {
      const removed = modules.find((m) => m.id === where.id)!;
      modules = modules.filter((m) => m.id !== where.id);
      // Cascade applicativo del fake: elimina le lezioni del modulo.
      lessons = lessons.filter((l) => l.moduleId !== where.id);
      return removed;
    },
  };

  const lessonApi = {
    findFirst: async ({ where }: any) =>
      lessons.find((l) => l.id === where.id && l.moduleId === where.moduleId) ?? null,
    findMany: async ({ where }: any) =>
      lessons.filter((l) => l.moduleId === where.moduleId).sort((a, b) => a.position - b.position),
    create: async ({ data }: any) => {
      const row: LessonRow = { id: nextId(), ...data };
      lessons.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const l = lessons.find((x) => x.id === where.id)!;
      Object.assign(l, data);
      return { ...l };
    },
    delete: async ({ where }: any) => {
      const removed = lessons.find((l) => l.id === where.id)!;
      lessons = lessons.filter((l) => l.id !== where.id);
      return removed;
    },
  };

  const prisma = {
    course: { findFirst: async () => seed.course },
    module: moduleApi,
    lesson: lessonApi,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  } as unknown as PrismaService;

  return { prisma, state: () => ({ modules, lessons }) };
}

const OUTLINE = {
  title: 'Corso',
  description: '',
  language: 'it',
  hasFinalAssessment: false,
  modules: [
    {
      title: 'Modulo A',
      summary: 'sintesi A',
      hasIntermediateAssessment: false,
      lessons: [
        { title: 'Lezione A1', objectives: ['o1', 'o2'], suggestedBlockTypes: [] },
        { title: 'Lezione A2', objectives: [], suggestedBlockTypes: [] },
      ],
    },
    {
      title: 'Modulo B',
      hasIntermediateAssessment: false,
      lessons: [{ title: 'Lezione B1', objectives: ['x'], suggestedBlockTypes: [] }],
    },
  ],
};

describe('ModulesService.materializeOutline', () => {
  it('crea moduli e lezioni dall outline con le position in ordine', async () => {
    const { prisma, state } = makeFakePrisma({
      course: { id: 'c1', tenantId: 't', outline: OUTLINE },
    });
    const service = new ModulesService(prisma);
    const result = await service.materializeOutline('t', 'c1');

    expect(result).toHaveLength(2);
    const { modules, lessons } = state();
    expect(modules.map((m) => m.position)).toEqual([0, 1]);
    expect(lessons).toHaveLength(3);
    const a1 = lessons.find((l) => l.title === 'Lezione A1');
    expect(a1?.objectives).toEqual(['o1', 'o2']);
  });

  it('è idempotente: non duplica moduli/lezioni già presenti', async () => {
    const { prisma, state } = makeFakePrisma({
      course: { id: 'c1', tenantId: 't', outline: OUTLINE },
      modules: [{ id: 'm1', courseId: 'c1', title: 'Modulo A', position: 0 }],
      lessons: [{ id: 'l1', moduleId: 'm1', title: 'Lezione A1', position: 0 }],
    });
    const service = new ModulesService(prisma);
    await service.materializeOutline('t', 'c1');
    const { modules, lessons } = state();
    // Modulo A riusato, Modulo B creato -> 2 moduli totali.
    expect(modules).toHaveLength(2);
    // Lezione A1 non duplicata; aggiunte A2 e B1 -> 3 totali.
    expect(lessons.filter((l) => l.title === 'Lezione A1')).toHaveLength(1);
    expect(lessons).toHaveLength(3);
  });

  it('rifiuta se il corso non ha un outline valido', async () => {
    const { prisma } = makeFakePrisma({ course: { id: 'c1', tenantId: 't', outline: null } });
    const service = new ModulesService(prisma);
    await expect(service.materializeOutline('t', 'c1')).rejects.toThrow(/outline/i);
  });

  it('riconcilia: rimuove moduli/lezioni VUOTI non più nell outline (no duplicati)', async () => {
    const { prisma, state } = makeFakePrisma({
      course: { id: 'c1', tenantId: 't', outline: OUTLINE },
      modules: [
        { id: 'm1', courseId: 'c1', title: 'Modulo A', position: 0 },
        // Modulo "vecchio" non più nell'outline e senza contenuti -> va rimosso.
        { id: 'mOld', courseId: 'c1', title: 'Modulo Vecchio', position: 1 },
      ],
      lessons: [
        { id: 'l1', moduleId: 'm1', title: 'Lezione A1', position: 0 },
        { id: 'lOld', moduleId: 'mOld', title: 'Vecchia', position: 0 },
      ],
    });
    const service = new ModulesService(prisma);
    await service.materializeOutline('t', 'c1');
    const { modules } = state();
    const titles = modules.map((m) => m.title).sort();
    // Modulo Vecchio rimosso; restano solo i moduli dell'outline.
    expect(titles).toEqual(['Modulo A', 'Modulo B']);
  });

  it('riconcilia: PRESERVA le lezioni con contenuti anche se non più nell outline', async () => {
    const { prisma, state } = makeFakePrisma({
      course: { id: 'c1', tenantId: 't', outline: OUTLINE },
      modules: [{ id: 'm1', courseId: 'c1', title: 'Modulo A', position: 0 }],
      lessons: [
        { id: 'l1', moduleId: 'm1', title: 'Lezione A1', position: 0 },
        // Lezione non più nell'outline MA con block -> va preservata.
        { id: 'lKeep', moduleId: 'm1', title: 'Lezione Con Contenuti', position: 1, blocks: [{ id: 'b', type: 'rich_text' }] } as unknown as LessonRow,
      ],
    });
    const service = new ModulesService(prisma);
    await service.materializeOutline('t', 'c1');
    const { lessons } = state();
    expect(lessons.some((l) => l.title === 'Lezione Con Contenuti')).toBe(true);
  });

  it('non duplica se i titoli differiscono solo per maiuscole/spazi', async () => {
    const { prisma, state } = makeFakePrisma({
      course: { id: 'c1', tenantId: 't', outline: OUTLINE },
      modules: [{ id: 'm1', courseId: 'c1', title: 'modulo a', position: 0 }],
      lessons: [{ id: 'l1', moduleId: 'm1', title: '  lezione  a1 ', position: 0 }],
    });
    const service = new ModulesService(prisma);
    await service.materializeOutline('t', 'c1');
    const { modules } = state();
    // 'modulo a' ~ 'Modulo A': riusato, non duplicato -> 2 moduli (A, B).
    expect(modules).toHaveLength(2);
  });
});

describe('ModulesService.deleteModule / deleteLesson', () => {
  it('elimina un modulo e ricompatta le position', async () => {
    const { prisma, state } = makeFakePrisma({
      course: { id: 'c1', tenantId: 't' },
      modules: [
        { id: 'm1', courseId: 'c1', title: 'A', position: 0 },
        { id: 'm2', courseId: 'c1', title: 'B', position: 1 },
        { id: 'm3', courseId: 'c1', title: 'C', position: 2 },
      ],
    });
    const service = new ModulesService(prisma);
    await service.deleteModule('t', 'c1', 'm2');
    const { modules } = state();
    expect(modules.map((m) => m.title)).toEqual(['A', 'C']);
    expect(modules.map((m) => m.position)).toEqual([0, 1]);
  });

  it('elimina una lezione e ricompatta le position nel modulo', async () => {
    const { prisma, state } = makeFakePrisma({
      course: { id: 'c1', tenantId: 't' },
      modules: [{ id: 'm1', courseId: 'c1', title: 'A', position: 0 }],
      lessons: [
        { id: 'l1', moduleId: 'm1', title: 'L1', position: 0 },
        { id: 'l2', moduleId: 'm1', title: 'L2', position: 1 },
        { id: 'l3', moduleId: 'm1', title: 'L3', position: 2 },
      ],
    });
    const service = new ModulesService(prisma);
    await service.deleteLesson('t', 'c1', 'm1', 'l1');
    const { lessons } = state();
    expect(lessons.map((l) => l.title)).toEqual(['L2', 'L3']);
    expect(lessons.map((l) => l.position)).toEqual([0, 1]);
  });
});
