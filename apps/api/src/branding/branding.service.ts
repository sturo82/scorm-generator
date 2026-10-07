import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AppBranding, type AppBrandingView, type UpdateAppBranding } from '@scorm/contracts';
import type { ObjectStorage } from '@scorm/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { OBJECT_STORAGE } from '../providers/provider.constants.js';

const ASSET_URL_TTL_SEC = 24 * 3600;

/**
 * Branding white-label della web app, per-tenant: nome, colore primario, logo e
 * favicon. Persistito in `Tenant.branding` (JSONB) e validato dallo schema
 * AppBranding. Gli asset (logo/favicon) vivono su object storage; la vista
 * risolve gli URL firmati per il client.
 */
@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** Branding corrente del tenant con URL firmati di logo/favicon. */
  async get(tenantId: string): Promise<AppBrandingView> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant non trovato');
    const branding = AppBranding.parse(tenant.branding ?? {});
    return this.toView(branding);
  }

  /** Aggiorna i campi testuali/colore del branding. */
  async update(tenantId: string, patch: UpdateAppBranding): Promise<AppBrandingView> {
    const current = await this.currentBranding(tenantId);
    const next = AppBranding.parse({ ...current, ...patch });
    await this.save(tenantId, next);
    return this.toView(next);
  }

  /** Carica il logo (o la favicon) e persiste la chiave nel branding. */
  async uploadAsset(
    tenantId: string,
    kind: 'logo' | 'favicon',
    file: { mimeType: string; content: Buffer },
  ): Promise<AppBrandingView> {
    const ext = extForBrandingMime(file.mimeType);
    if (!ext) {
      throw new BadRequestException('Formato non supportato (usa PNG, SVG, WebP o ICO).');
    }
    const MAX_BYTES = 2 * 1024 * 1024;
    if (file.content.byteLength > MAX_BYTES) {
      throw new BadRequestException('File troppo grande (max 2MB).');
    }
    const key = `branding/${tenantId}/${kind}-${randomUUID()}.${ext}`;
    await this.storage.putObject(key, file.content, { contentType: file.mimeType });
    const current = await this.currentBranding(tenantId);
    const next = AppBranding.parse({
      ...current,
      ...(kind === 'logo' ? { logoKey: key } : { faviconKey: key }),
    });
    await this.save(tenantId, next);
    return this.toView(next);
  }

  private async currentBranding(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant non trovato');
    return AppBranding.parse(tenant.branding ?? {});
  }

  private async save(tenantId: string, branding: AppBranding): Promise<void> {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { branding: branding as object },
    });
  }

  private async toView(branding: AppBranding): Promise<AppBrandingView> {
    const sign = async (key: string | null): Promise<string | null> => {
      if (!key) return null;
      try {
        return await this.storage.getSignedUrl(key, { expiresInSec: ASSET_URL_TTL_SEC });
      } catch {
        return null;
      }
    };
    return {
      ...branding,
      logoUrl: await sign(branding.logoKey),
      faviconUrl: await sign(branding.faviconKey),
    };
  }
}

/** Estensione per i MIME ammessi per logo/favicon (null se non supportato). */
function extForBrandingMime(mime: string): string | null {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/svg+xml':
      return 'svg';
    case 'image/webp':
      return 'webp';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon':
      return 'ico';
    default:
      return null;
  }
}
