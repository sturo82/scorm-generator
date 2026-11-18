import { randomUUID } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service.js';
import { UserTokenService } from '../sso/user-token.service.js';
import { EntitlementService } from '../ecosystem/entitlement.service.js';
import { mapEcoRoleToInternal } from '../ecosystem/eco-role.js';
import { AUTH_PROVIDER, type AuthProvider } from './auth-provider.js';
import { AUTH_CONTEXT_KEY, type AuthContext } from './auth-context.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { setRequestPayer } from '../billing/payer-context.js';
import { BillingService } from '../billing/billing.service.js';
import { EcosystemSettingsService } from '../ecosystem/ecosystem-settings.service.js';

interface IncomingRequest {
  headers: Record<string, string | string[] | undefined>;
  [AUTH_CONTEXT_KEY]?: AuthContext;
}

/**
 * Guard di autenticazione:
 *  1. salta le rotte marcate @Public();
 *  2. estrae il bearer token e lo verifica tramite AuthProvider;
 *  3. risolve l'utente dal DB per (tenantId, externalId) — garantendo che il
 *     token appartenga a un utente reale del tenant (Requisito 1.1 / 1.6);
 *  4. allega alla request un AuthContext con tenant, ruolo e correlationId
 *     (Requisito 11.2) usato da autorizzazione e tracciabilità.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_PROVIDER) private readonly auth: AuthProvider,
    private readonly prisma: PrismaService,
    private readonly userTokens: UserTokenService,
    private readonly entitlements: EntitlementService,
    private readonly settings: EcosystemSettingsService,
    private readonly billing: BillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<IncomingRequest>();
    const token = this.extractBearer(request);
    if (!token) {
      throw new UnauthorizedException('Token di accesso mancante');
    }

    // Due canali di sessione utente, provati in ordine:
    //  1) token utente SSO (JWT nostro, kind=user, chiave dedicata) — Scenario 2;
    //  2) il provider configurato (dev/jwt/oidc).
    // Il token SSO si riconosce da un verify che va a buon fine con la sua chiave;
    // in caso contrario si ricade sul provider principale.
    let claims: { subject: string; tenantId: string; email?: string; ecoRole?: string; personal?: boolean };
    const ssoClaims = this.tryVerifySsoToken(token);
    if (ssoClaims) {
      claims = ssoClaims;
    } else {
      try {
        claims = await this.auth.verify(token);
      } catch {
        throw new UnauthorizedException('Token di accesso non valido');
      }
    }

    // Gate di entitlement d'ecosistema: la company (= tenant, slug dal token)
    // deve avere un contratto attivo per K Scorm. Controllato da Manager (fonte
    // di verità) PRIMA di risolvere/creare l'utente, così il JIT non crea utenti
    // per company non abilitate. No-op se ENTITLEMENT_ENFORCE=off; in 'hard'
    // lancia 403; fail-open su errori infrastrutturali (vedi service).
    const personal = claims.personal === true;
    if (personal) {
      // Spazio personale (utente senza company): non c'è un contratto da verificare, ma si lavora
      // solo con il wallet attivo, perché le generazioni le paga l'utente col suo wallet personale.
      if (!this.settings.walletEnabled) {
        throw new ForbiddenException('Lo spazio personale non è ancora disponibile.');
      }
    } else {
      await this.entitlements.assertCompanyEntitled(claims.tenantId);
    }
    let user: {
      id: string;
      role: AuthContext['role'];
      tenantId: string;
      walletPayer?: string;
      personalWalletId?: string | null;
    } | null = await this.prisma.user.findUnique({
      where: {
        tenantId_externalId: { tenantId: claims.tenantId, externalId: claims.subject },
      },
      select: { id: true, role: true, tenantId: true, walletPayer: true, personalWalletId: true },
    });

    // In modalità dev, auto-provisiona tenant/utente al primo accesso così il
    // frontend può lavorare contro l'API vera senza seed manuale.
    if (!user && this.auth.id === 'dev') {
      user = await this.provisionDevUser(claims.tenantId, claims.subject, claims.email);
    }

    // JIT provisioning d'ecosistema (solo provider OIDC): al primo accesso, dopo
    // che il gate ha confermato l'entitlement, crea l'utente dai claim del token
    // mappando l'eco-role sul ruolo interno. Così l'owner entra senza essere
    // pre-creato. Non attivo in dev (gestito sopra) né per i token SSO.
    if (!user && this.auth.id === 'oidc') {
      user = await this.provisionEcosystemUser(
        claims.tenantId,
        claims.subject,
        claims.email,
        claims.ecoRole,
        personal,
      );
    }

    if (!user) {
      throw new UnauthorizedException('Utente non riconosciuto per il tenant');
    }

    const correlationId = this.correlationId(request);
    const authContext: AuthContext = {
      tenant: { tenantId: user.tenantId },
      userId: user.id,
      role: user.role,
      correlationId,
    };
    request[AUTH_CONTEXT_KEY] = authContext;
    // Wallet che paga le generazioni di questa richiesta: quello personale se l'utente l'ha scelto
    // (id assegnato da Manager), altrimenti l'azienda (default, gestito da BillingService).
    // Nello spazio personale paga sempre il wallet personale: l'id lo assegna Manager alla prima volta.
    let personalWalletId = user.personalWalletId ?? undefined;
    if (personal && !personalWalletId) {
      try {
        personalWalletId = await this.billing.ensurePersonalWallet(user.tenantId, user.id);
      } catch {
        throw new ServiceUnavailableException('Wallet personale momentaneamente non disponibile: riprova tra poco.');
      }
    }
    setRequestPayer(
      personalWalletId && (personal || user.walletPayer === 'PERSONAL')
        ? { companyId: personalWalletId, kind: 'personal' }
        : undefined,
    );
    return true;
  }

  /** Crea plan+tenant+utente OWNER dev se non esistono (solo AUTH_PROVIDER=dev). */
  private async provisionDevUser(tenantId: string, externalId: string, email?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
      const existingTenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!existingTenant) {
        const plan = await tx.plan.create({
          data: { tier: 'ENTERPRISE', limits: {}, featureFlags: {} },
        });
        await tx.tenant.create({ data: { id: tenantId, name: 'Dev Tenant', planId: plan.id } });
      }
      await tx.user.upsert({
        where: { tenantId_externalId: { tenantId, externalId } },
        update: {},
        create: {
          tenantId,
          externalId,
          email: email ?? 'dev@example.test',
          displayName: 'Dev Owner',
          role: 'OWNER',
        },
      });
    });
    return this.prisma.user.findUnique({
      where: { tenantId_externalId: { tenantId, externalId } },
      select: { id: true, role: true, tenantId: true },
    });
  }

  /**
   * JIT provisioning d'ecosistema (provider OIDC). Al primo accesso di un owner
   * la cui company è stata confermata attiva dal gate, crea tenant (se assente) e
   * utente dai claim del token. Il ruolo interno deriva dal mapping dell'eco-role
   * (`custom:eco_role`), con default sicuro VIEWER. Mirror del flusso di
   * seed-owner.mjs (RLS set_config + plan + tenant + user), reso idempotente.
   */
  private async provisionEcosystemUser(
    tenantId: string,
    externalId: string,
    email: string | undefined,
    ecoRole: string | undefined,
    personal = false,
  ) {
    // Nello spazio personale l'utente è l'unico del suo tenant, quindi ne è il titolare.
    const role = personal ? 'OWNER' : mapEcoRoleToInternal(ecoRole);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
      const existingTenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!existingTenant) {
        // Company nuova (pilota/cliente interno): crea un piano di default.
        const plan = await tx.plan.create({
          data: personal
            ? { tier: 'PREMIUM', limits: { maxUsers: 1, maxBrands: 3, maxKnowledgeMb: 500 }, featureFlags: {} }
            : { tier: 'ENTERPRISE', limits: {}, featureFlags: {} },
        });
        await tx.tenant.create({
          data: { id: tenantId, name: personal ? (email ?? 'Spazio personale') : tenantId, planId: plan.id },
        });
      }
      await tx.user.upsert({
        where: { tenantId_externalId: { tenantId, externalId } },
        update: {},
        create: {
          tenantId,
          externalId,
          email: email ? email.toLowerCase() : `${externalId}@no-email.local`,
          displayName: email ?? 'Owner',
          role,
          ...(personal ? { walletPayer: 'PERSONAL' } : {}),
        },
      });
    });
    return this.prisma.user.findUnique({
      where: { tenantId_externalId: { tenantId, externalId } },
      select: { id: true, role: true, tenantId: true, walletPayer: true, personalWalletId: true },
    });
  }
  /**
   * Prova a interpretare il bearer come token utente SSO (kind=user). Ritorna i
   * claim normalizzati se valido, altrimenti undefined (non è un token SSO o è
   * scaduto): in tal caso si ricade sul provider principale.
   */
  private tryVerifySsoToken(
    token: string,
  ): { subject: string; tenantId: string; email?: string } | undefined {
    try {
      const c = this.userTokens.verify(token);
      return { subject: c.sub, tenantId: c.tenantId, email: c.email };
    } catch {
      return undefined;
    }
  }

  private extractBearer(request: IncomingRequest): string | undefined {
    const header = request.headers['authorization'];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value) return undefined;
    const [scheme, token] = value.split(' ');
    return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
  }

  private correlationId(request: IncomingRequest): string {
    const header = request.headers['x-correlation-id'];
    const value = Array.isArray(header) ? header[0] : header;
    return value && value.length > 0 ? value : randomUUID();
  }
}
