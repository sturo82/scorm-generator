import { describe, it, expect, vi } from 'vitest';
import { NotImplementedException, NotFoundException } from '@nestjs/common';
import { StockImagesService } from './stock-images.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ObjectStorage, StockImageProvider } from '@scorm/domain';

const photo = {
  id: 'p1',
  provider: 'pexels',
  thumbUrl: 'https://x/thumb.jpg',
  alt: 'una foto',
  attribution: { provider: 'Pexels', authorName: 'Jane', authorUrl: 'https://x/jane', sourceUrl: 'https://x/p1' },
  width: 1200,
  height: 800,
};

function makeService(opts?: {
  provider?: StockImageProvider | null;
  lesson?: { id: string; blocks: unknown[] } | null;
}) {
  const update = vi.fn(async () => ({}));
  const prisma = {
    lesson: {
      findFirst: async () =>
        opts && 'lesson' in opts
          ? opts.lesson
          : {
              id: 'l1',
              blocks: [
                { id: 'b1', type: 'image_hotspot', payload: { image: { kind: 'image', alt: '', placeholderPrompt: 'vecchio' }, hotspots: [] } },
              ],
            },
      update,
    },
  } as unknown as PrismaService;
  const putObject = vi.fn(async () => undefined);
  const storage = {
    putObject,
    getSignedUrl: async () => 'https://signed/url.jpg',
  } as unknown as ObjectStorage;
  const provider =
    opts && 'provider' in opts
      ? opts.provider
      : ({
          id: 'pexels',
          search: vi.fn(async () => [photo]),
          fetchFull: vi.fn(async () => ({
            bytes: new Uint8Array([1, 2, 3]),
            contentType: 'image/jpeg',
            alt: 'una foto',
            attribution: photo.attribution,
          })),
        } as unknown as StockImageProvider);
  const svc = new StockImagesService(prisma, storage, provider);
  return { svc, prisma, putObject, update, provider };
}

describe('StockImagesService.search', () => {
  it('ritorna i risultati mappati del provider', async () => {
    const { svc } = makeService();
    const res = await svc.search('montagna');
    expect(res.provider).toBe('pexels');
    expect(res.results[0]).toMatchObject({ id: 'p1', authorName: 'Jane', thumbUrl: 'https://x/thumb.jpg' });
  });

  it('query vuota → nessun risultato (nessuna chiamata al provider)', async () => {
    const { svc, provider } = makeService();
    const res = await svc.search('   ');
    expect(res.results).toHaveLength(0);
    expect((provider as unknown as { search: ReturnType<typeof vi.fn> }).search).not.toHaveBeenCalled();
  });

  it('provider non configurato → 501', async () => {
    const { svc } = makeService({ provider: null });
    await expect(svc.search('x')).rejects.toBeInstanceOf(NotImplementedException);
  });
});

describe('StockImagesService.attachToBlock', () => {
  it('scarica i byte, salva su storage e scrive storageKey + attribuzione nel MediaRef', async () => {
    const { svc, putObject, update } = makeService();
    const res = await svc.attachToBlock('t1', 'c1', 'l1', { blockId: 'b1', photoId: 'p1', alt: 'nuovo alt' });
    expect(res.attached).toBe(true);
    expect(res.url).toBe('https://signed/url.jpg');
    // byte salvati su storage.
    expect(putObject).toHaveBeenCalledTimes(1);
    // Il MediaRef nel block è stato aggiornato (persistito via lesson.update).
    const savedBlocks = (update.mock.calls[0]![0] as { data: { blocks: unknown[] } }).data.blocks;
    const img = (savedBlocks[0] as { payload: { image: Record<string, unknown> } }).payload.image;
    expect(img.source).toBe('stock');
    expect(typeof img.storageKey).toBe('string');
    expect((img.storageKey as string).includes('/stock/')).toBe(true);
    expect(img.alt).toBe('nuovo alt');
    expect(img.attribution).toMatchObject({ provider: 'Pexels', authorName: 'Jane' });
    expect(img.placeholderPrompt).toBeUndefined();
  });

  it('block senza MediaRef immagine → 404', async () => {
    const { svc } = makeService({
      lesson: { id: 'l1', blocks: [{ id: 'b1', type: 'rich_text', payload: { content: { html: 'x' } } }] },
    });
    await expect(
      svc.attachToBlock('t1', 'c1', 'l1', { blockId: 'b1', photoId: 'p1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('provider non configurato → 501', async () => {
    const { svc } = makeService({ provider: null });
    await expect(
      svc.attachToBlock('t1', 'c1', 'l1', { blockId: 'b1', photoId: 'p1' }),
    ).rejects.toBeInstanceOf(NotImplementedException);
  });
});
