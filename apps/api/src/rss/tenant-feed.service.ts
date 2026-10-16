import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { FeedProvider } from '@scorm/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { FEED_PROVIDER } from '../providers/provider.constants.js';

export interface TenantFeedView {
  id: string;
  url: string;
  name: string;
  createdAt: string;
}

const MAX_TENANT_FEEDS = 50;

/**
 * Gestione dei feed RSS personalizzati salvati per il tenant. Usati (in
 * aggiunta o in alternativa ai predefiniti) nella creazione di corsi da
 * argomento. In aggiunta valida il feed al salvataggio (anti-SSRF + parsabile)
 * e ne ricava il nome dal titolo se non fornito.
 */
@Injectable()
export class TenantFeedService {
  private readonly logger = new Logger(TenantFeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FEED_PROVIDER) private readonly feeds: FeedProvider,
  ) {}

  async list(tenantId: string): Promise<TenantFeedView[]> {
    const rows = await this.prisma.tenantFeed.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toView);
  }

  async add(tenantId: string, url: string, name?: string): Promise<TenantFeedView> {
    const cleanUrl = (url ?? '').trim();
    if (!cleanUrl) throw new BadRequestException('URL del feed mancante');

    const count = await this.prisma.tenantFeed.count({ where: { tenantId } });
    if (count >= MAX_TENANT_FEEDS) {
      throw new BadRequestException(`Hai raggiunto il massimo di ${MAX_TENANT_FEEDS} feed salvati`);
    }

    // Valida il feed scaricandone le voci (passa per l'anti-SSRF dell'adapter)
    // e ricava un nome dal titolo del feed se non fornito.
    let resolvedName = name?.trim() || '';
    try {
      const probe = await this.feeds.listItems(cleanUrl, { maxItems: 1 });
      if (!resolvedName) resolvedName = probe.feedTitle?.trim() || hostOf(cleanUrl);
    } catch (err) {
      throw new BadRequestException(
        `Feed non valido o non raggiungibile: ${err instanceof Error ? err.message : 'errore'}`,
      );
    }

    try {
      const row = await this.prisma.tenantFeed.create({
        data: { tenantId, url: cleanUrl, name: resolvedName || hostOf(cleanUrl) },
      });
      return toView(row);
    } catch (err) {
      // Violazione unique (tenantId,url): feed già presente.
      if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002') {
        throw new BadRequestException('Questo feed è già salvato');
      }
      throw err;
    }
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const row = await this.prisma.tenantFeed.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!row) throw new NotFoundException('Feed non trovato');
    await this.prisma.tenantFeed.delete({ where: { id: row.id } });
  }
}

function toView(row: { id: string; url: string; name: string; createdAt: Date }): TenantFeedView {
  return { id: row.id, url: row.url, name: row.name, createdAt: row.createdAt.toISOString() };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
