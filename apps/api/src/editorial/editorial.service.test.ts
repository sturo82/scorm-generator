import { describe, it, expect, vi } from 'vitest';
import { EditorialService, sanitizeBlock } from './editorial.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { Block } from '@scorm/contracts';

const now = new Date('2026-01-01T10:00:00.000Z');

function makeService(opts?: { lessonUpdatedAt?: Date }) {
  const lessonUpdate = vi.fn(async () => ({ id: 'l1' }));
  const versionCreate = vi.fn(async () => ({ id: 'v1' }));
  const prisma = {
    course: { findFirst: async () => ({ id: 'c1', tenantId: 't1' }) },
    lesson: {
      findFirst: async () => ({
        id: 'l1',
        updatedAt: opts?.lessonUpdatedAt ?? now,
        blocks: [],
      }),
      update: lessonUpdate,
    },
    contentVersion: {
      findFirst: async () => ({ version: 2 }),
      create: versionCreate,
    },
  } as unknown as PrismaService;
  return { service: new EditorialService(prisma), lessonUpdate, versionCreate };
}

const richBlock: Block = {
  id: 'b1',
  type: 'rich_text',
  editorial: { status: 'draft', citations: [] },
  payload: { content: { format: 'html', html: '<p>ok</p><script>alert(1)</script>' }, media: [] },
};

describe('EditorialService.editLessonBlocks', () => {
  it('salva se il token di concorrenza combacia e crea uno snapshot', async () => {
    const { service, lessonUpdate, versionCreate } = makeService();
    await service.editLessonBlocks('t1', 'c1', 'l1', {
      blocks: [richBlock],
      expectedUpdatedAt: now.toISOString(),
    });
    expect(versionCreate).toHaveBeenCalledOnce(); // snapshot prima della modifica
    expect(lessonUpdate).toHaveBeenCalledOnce();
  });

  it('lancia conflitto se il token non combacia (lock ottimistico)', async () => {
    const { service } = makeService();
    await expect(
      service.editLessonBlocks('t1', 'c1', 'l1', {
        blocks: [richBlock],
        expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      }),
    ).rejects.toThrow(/modificato da un altro utente/i);
  });

  it('sanifica l HTML dei block prima di salvare', async () => {
    const { service, lessonUpdate } = makeService();
    await service.editLessonBlocks('t1', 'c1', 'l1', {
      blocks: [richBlock],
      expectedUpdatedAt: now.toISOString(),
    });
    const saved = lessonUpdate.mock.calls[0]?.[0]?.data?.blocks as Block[];
    const html = (saved[0]?.payload as { content: { html: string } }).content.html;
    expect(html).toContain('<p>ok</p>');
    expect(html).not.toContain('script');
  });
});

describe('sanitizeBlock', () => {
  it('sanifica il contenuto di una flashcard', () => {
    const block: Block = {
      id: 'f1',
      type: 'flashcard',
      editorial: { status: 'draft', citations: [] },
      payload: {
        cards: [
          {
            id: 'c1',
            front: { format: 'html', html: '<p>Q</p><img src=x onerror=alert(1)>' },
            back: { format: 'html', html: '<em>A</em>' },
          },
        ],
      },
    };
    const out = sanitizeBlock(block);
    const front = (out.payload as { cards: Array<{ front: { html: string } }> }).cards[0]?.front.html;
    expect(front).not.toContain('onerror');
    expect(front).toContain('<p>Q</p>');
  });

  it('non altera i tipi senza rich-text (dragdrop)', () => {
    const block: Block = {
      id: 'd1',
      type: 'dragdrop_match',
      editorial: { status: 'draft', citations: [] },
      payload: {
        points: 1,
        prompt: 'Abbina',
        pairs: [
          { id: 'p1', left: 'A', right: '1' },
          { id: 'p2', left: 'B', right: '2' },
        ],
      },
    };
    expect(() => sanitizeBlock(block)).not.toThrow();
  });
});
