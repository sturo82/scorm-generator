import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantPrismaService } from '../tenancy/tenant-prisma.service.js';
import { UserTokenService } from './user-token.service.js';
import type { AppConfig } from '../config/configuration.js';
import type { IssueTicketInput } from './dto.js';

const ROLE_RANK: Record<UserRole, number> = { OWNER: 3, ADMIN: 2, EDITOR: 1, VIEWER: 0 };

/** Esito dell'emissione di un ticket SSO. */
export interface IssueTicketResult {
  /** Ticket in chiaro: consegnato alla terza parte, da passare nel redirect. */
  ticket: string;
  /** URL pronto a cui reindirizzare il browser dell'utente. */
  redirectUrl: string;
  expiresInSec: number;
}

/** Esito del redeem: sessione utente per la web app. */
export interface RedeemResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresInSec: number;
  user: { id: string; email: string; displayName: string | null; role: UserRole };
  tenant: { id: string };
}

/**
 * SSO via ticket (Scenario 2). Una piattaforma terza, autenticata con la sua API
 * key (IntegrationClient + scope sso:issue), chiede un ticket per un utente;
 * l'utente è provisioning-ato JIT nel tenant della API key. Il browser scambia
 * il ticket (monouso, breve) con un token utente.
 *
 * Garanzie di sicurezza:
 *  - il tenant è SEMPRE quello della API key (mai dall'input);
 *  - il ruolo richiesto è limitato a `sso.maxRole` (mai OWNER);
 *  - il ticket è salvato come hash, scade in pochi secondi, è monouso.
 */
@Injectable()
export class SsoService {
  private readonly cfg: AppConfig['sso'];
  private readonly webAppUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly userTokens: UserTokenService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cfg = config.get('sso', { infer: true });
    this.webAppUrl = config.get('webAppUrl', { infer: true });
  }

  /**
   * Provisiona (JIT) l'utente nel tenant e crea un ticket monouso.
   * @param tenantId tenant della API key (dal ServiceContext)
   * @param clientId client di integrazione emittente (per audit)
   */
  async issueTicket(
    tenantId: string,
    clientId: string,
    input: IssueTicketInput,
  ): Promise<IssueTicketResult> {
    const requestedRole = (input.role ?? 'VIEWER') as UserRole;
    // Cap del ruolo: la terza parte non può assegnare più di maxRole, mai OWNER.
    if (ROLE_RANK[requestedRole] > ROLE_RANK[this.cfg.maxRole as UserRole]) {
      throw new BadRequestException(
        `Ruolo "${requestedRole}" non consentito via SSO (massimo: ${this.cfg.maxRole})`,
      );
    }

    const email = input.email.trim().toLowerCase();
    // externalId stabile: quello fornito dalla terza parte, altrimenti derivato
    // dall'email con un prefisso che evita collisioni con i sub Cognito.
    const externalId = input.externalId?.trim() || `sso:${email}`;
    const displayName = input.displayName?.trim() || email;

    // Provisioning JIT + creazione ticket in un'unica transazione tenant (RLS).
    const ticket = randomBytes(32).toString('base64url');
    const tokenHash = sha256(ticket);
    const expiresAt = new Date(Date.now() + this.cfg.ticketTtlSec * 1000);

    await this.tenantPrisma.runInTenant(tenantId, async (tx) => {
      // Upsert dell'utente per (tenantId, externalId). Se l'utente esiste già,
      // aggiorna nome/ruolo secondo quanto dichiarato dalla terza parte (fonte
      // di verità per i suoi utenti). Il tenant DEVE preesistere (FK).
      const user = await tx.user.upsert({
        where: { tenantId_externalId: { tenantId, externalId } },
        update: { email, displayName, role: requestedRole },
        create: { tenantId, externalId, email, displayName, role: requestedRole },
        select: { id: true },
      });
      await tx.ssoTicket.create({
        data: { tenantId, tokenHash, userId: user.id, clientId, expiresAt },
      });
    });

    const redirectUrl = `${this.webAppUrl.replace(/\/$/, '')}/sso?ticket=${encodeURIComponent(ticket)}`;
    return { ticket, redirectUrl, expiresInSec: this.cfg.ticketTtlSec };
  }

  /**
   * Consuma un ticket (monouso) ed emette un token utente. Validazioni: esiste,
   * non scaduto, non già usato. Marca `usedAt` nella stessa operazione.
   */
  async redeemTicket(ticket: string): Promise<RedeemResult> {
    const tokenHash = sha256(ticket.trim());
    const row = await this.prisma.ssoTicket.findUnique({
      where: { tokenHash },
      include: {
        user: { select: { id: true, externalId: true, email: true, displayName: true, role: true } },
      },
    });
    if (!row) throw new UnauthorizedException('Ticket SSO non valido');
    if (row.usedAt) throw new UnauthorizedException('Ticket SSO già utilizzato');
    if (row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Ticket SSO scaduto');
    }

    // Consuma il ticket (monouso) in modo atomico: l'update condizionato su
    // usedAt=null evita doppi redeem concorrenti.
    const consumed = await this.prisma.ssoTicket.updateMany({
      where: { tokenHash, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new UnauthorizedException('Ticket SSO già utilizzato');
    }

    const { accessToken, expiresInSec } = this.userTokens.sign({
      externalId: row.user.externalId,
      tenantId: row.tenantId,
      email: row.user.email,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresInSec,
      user: {
        id: row.user.id,
        email: row.user.email,
        displayName: row.user.displayName,
        role: row.user.role,
      },
      tenant: { id: row.tenantId },
    };
  }
}

/** sha256 esadecimale del valore del ticket. */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
