import { randomUUID } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service.js';
import { UserTokenService } from '../sso/user-token.service.js';
import { AUTH_PROVIDER, type AuthProvider } from './auth-provider.js';
import { AUTH_CONTEXT_KEY, type AuthContext } from './auth-context.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

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
    let claims: { subject: string; tenantId: string; email?: string };
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

    let user = await this.prisma.user.findUnique({
      where: {
        tenantId_externalId: { tenantId: claims.tenantId, externalId: claims.subject },
      },
      select: { id: true, role: true, tenantId: true },
    });

    // In modalità dev, auto-provisiona tenant/utente al primo accesso così il
    // frontend può lavorare contro l'API vera senza seed manuale.
    if (!user && this.auth.id === 'dev') {
      user = await this.provisionDevUser(claims.tenantId, claims.subject, claims.email);
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
