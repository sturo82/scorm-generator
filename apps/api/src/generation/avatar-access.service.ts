import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import type { VideoGenerationProvider } from '@scorm/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { VIDEO_GEN_PROVIDER } from '../providers/provider.constants.js';

/** Chi sta chiedendo: tenant, utente e ruolo. */
export interface AvatarViewer {
  tenantId: string;
  userId: string;
  role: UserRole;
}

/** Appartenenza di un avatar, come la vede chi lo gestisce. */
export interface AvatarAccessView {
  tenantId: string;
  tenantName: string;
  /** Vuoto = tutto il tenant. */
  userIds: string[];
  /** True se chi chiede può cambiare a chi appartiene. */
  canManage: boolean;
}

/** Destinatari tra cui scegliere (aziende e utenti). */
export interface AvatarAccessTargets {
  tenants: Array<{ id: string; name: string }>;
  users: Array<{ id: string; tenantId: string; email: string; displayName: string | null }>;
  /** True se si può scegliere anche l'azienda (solo la piattaforma). */
  canPickTenant: boolean;
}

const isAdmin = (role: UserRole) => role === 'ADMIN' || role === 'OWNER';

/**
 * Chi può vedere e usare gli avatar HeyGen. L'account HeyGen è uno solo, quindi l'appartenenza si
 * tiene da noi: ogni avatar è di un tenant e, se serve, solo di alcuni suoi utenti. Gli avatar
 * senza riga (creati dalla dashboard di HeyGen o prima di questa regola) sono del tenant della
 * piattaforma, che poi li assegna.
 */
@Injectable()
export class AvatarAccessService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(VIDEO_GEN_PROVIDER) private readonly videoGen: VideoGenerationProvider | null,
  ) {}

  /** Tenant a cui appartengono gli avatar non assegnati. */
  get platformTenantId(): string {
    return process.env['AVATAR_DEFAULT_TENANT'] || 'knowkube';
  }

  isPlatform(viewer: AvatarViewer): boolean {
    return viewer.tenantId === this.platformTenantId;
  }

  private async rows() {
    const rows = await this.prisma.avatarAccess.findMany();
    return new Map(rows.map((r) => [r.groupId, r]));
  }

  /** `manage`: gli admin della piattaforma vedono tutto per poterlo assegnare (non per usarlo). */
  private visible(row: { tenantId: string; userIds: string[] } | undefined, v: AvatarViewer, manage = false): boolean {
    if (manage && this.isPlatform(v) && isAdmin(v.role)) return true;
    const owner = row?.tenantId ?? this.platformTenantId;
    if (owner !== v.tenantId) return false;
    if (!row || row.userIds.length === 0) return true;
    return isAdmin(v.role) || row.userIds.includes(v.userId);
  }

  /** Tiene solo gli avatar che l'utente può vedere (quelli senza groupId non sono dell'account: restano). */
  async filterVisible<T extends { groupId?: string }>(viewer: AvatarViewer, items: T[], manage = false): Promise<T[]> {
    const rows = await this.rows();
    return items.filter((i) => !i.groupId || this.visible(rows.get(i.groupId), viewer, manage));
  }

  /** Appartenenza di ogni gruppo, per mostrarla nella pagina avatar. */
  async viewsFor(viewer: AvatarViewer, groupIds: string[]): Promise<Map<string, AvatarAccessView>> {
    const rows = await this.rows();
    const owners = new Set<string>([this.platformTenantId, ...[...rows.values()].map((r) => r.tenantId)]);
    const tenants = await this.prisma.tenant.findMany({ where: { id: { in: [...owners] } }, select: { id: true, name: true } });
    const names = new Map(tenants.map((t) => [t.id, t.name]));
    const out = new Map<string, AvatarAccessView>();
    for (const id of groupIds) {
      const row = rows.get(id);
      const tenantId = row?.tenantId ?? this.platformTenantId;
      out.set(id, {
        tenantId,
        tenantName: names.get(tenantId) ?? tenantId,
        userIds: row?.userIds ?? [],
        canManage: isAdmin(viewer.role) && (this.isPlatform(viewer) || tenantId === viewer.tenantId),
      });
    }
    return out;
  }

  /** Lancia 404 se l'avatar (gruppo) non esiste per chi lo gestisce. */
  async assertGroupVisible(viewer: AvatarViewer, groupId: string): Promise<void> {
    const row = await this.prisma.avatarAccess.findUnique({ where: { groupId } });
    if (!this.visible(row ?? undefined, viewer, true)) throw new NotFoundException('Avatar non trovato');
  }

  /**
   * Controlla che l'utente possa usare un avatar per generare un video. Gli avatar stock del
   * catalogo HeyGen sono di tutti; quelli dell'account solo di chi ne ha accesso.
   */
  async assertAvatarUsable(viewer: AvatarViewer, avatarId: string | undefined): Promise<void> {
    if (!avatarId || !this.videoGen) return;
    const mine = await this.videoGen.listAvatarsPage({ source: 'mine' }).catch(() => null);
    const found = mine?.items.find((a) => a.id === avatarId);
    if (!found || !found.groupId) return;
    const row = await this.prisma.avatarAccess.findUnique({ where: { groupId: found.groupId } });
    if (!this.visible(row ?? undefined, viewer)) {
      throw new ForbiddenException('Non hai accesso a questo avatar.');
    }
  }

  /** Registra un avatar appena creato: appartiene al tenant di chi lo crea, a tutti i suoi utenti. */
  async register(tenantId: string, groupId: string, createdBy?: string): Promise<void> {
    await this.prisma.avatarAccess.upsert({
      where: { groupId },
      create: { groupId, tenantId, createdBy: createdBy ?? null, userIds: [] },
      update: {},
    });
  }

  async remove(groupId: string): Promise<void> {
    await this.prisma.avatarAccess.deleteMany({ where: { groupId } });
  }

  /** Aziende e utenti tra cui scegliere. La piattaforma vede tutto, un admin solo il proprio tenant. */
  async targets(viewer: AvatarViewer): Promise<AvatarAccessTargets> {
    if (!isAdmin(viewer.role)) throw new ForbiddenException('Ruolo non autorizzato per questa operazione');
    const platform = this.isPlatform(viewer);
    const [tenants, users] = await Promise.all([
      this.prisma.tenant.findMany({ where: platform ? {} : { id: viewer.tenantId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.user.findMany({
        where: platform ? {} : { tenantId: viewer.tenantId },
        select: { id: true, tenantId: true, email: true, displayName: true },
        orderBy: { email: 'asc' },
      }),
    ]);
    return { tenants, users, canPickTenant: platform };
  }

  /** Cambia a chi appartiene un avatar: azienda (solo la piattaforma) e utenti ammessi (vuoto = tutti). */
  async assign(viewer: AvatarViewer, groupId: string, input: { tenantId?: string; userIds: string[] }): Promise<AvatarAccessView> {
    const row = await this.prisma.avatarAccess.findUnique({ where: { groupId } });
    const currentOwner = row?.tenantId ?? this.platformTenantId;
    const platform = this.isPlatform(viewer);
    if (!isAdmin(viewer.role) || (!platform && currentOwner !== viewer.tenantId)) {
      throw new ForbiddenException('Ruolo non autorizzato per questa operazione');
    }
    const target = platform ? input.tenantId || currentOwner : currentOwner;
    if (!platform && input.tenantId && input.tenantId !== currentOwner) {
      throw new ForbiddenException('Solo la piattaforma può spostare un avatar in un\'altra azienda.');
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { id: target }, select: { id: true, name: true } });
    if (!tenant) throw new BadRequestException('Azienda non trovata');
    const userIds = [...new Set(input.userIds)];
    if (userIds.length > 0) {
      const found = await this.prisma.user.count({ where: { id: { in: userIds }, tenantId: target } });
      if (found !== userIds.length) throw new BadRequestException('Alcuni utenti non appartengono all\'azienda scelta.');
    }
    await this.prisma.avatarAccess.upsert({
      where: { groupId },
      create: { groupId, tenantId: target, createdBy: viewer.userId, userIds },
      update: { tenantId: target, userIds },
    });
    return { tenantId: target, tenantName: tenant.name, userIds, canManage: true };
  }
}
