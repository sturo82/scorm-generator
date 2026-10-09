import { randomUUID } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service.js';
import { ServiceTokenService } from './service-token.service.js';
import { SERVICE_CONTEXT_KEY, type ServiceContext } from './service-context.js';
import { REQUIRED_SCOPES_KEY } from './required-scopes.decorator.js';
import type { IntegrationScope } from './integration-scopes.js';

interface IncomingRequest {
  headers: Record<string, string | string[] | undefined>;
  [SERVICE_CONTEXT_KEY]?: ServiceContext;
}

/**
 * Guard per gli endpoint di integrazione B2B (macchina-a-macchina). Diversa
 * dall'AuthGuard utente: NON risolve un record User, ma valida un token di
 * servizio (JWT HS256 nostro) e popola un ServiceContext con tenant + scopi.
 *
 * Si applica esplicitamente ai controller di integrazione (non è globale). Gli
 * endpoint restano quindi fuori dal percorso dell'auth utente, che li salta
 * perché marcati @Public.
 *
 * Verifica, in ordine: firma/scadenza del token, che il client esista e sia
 * ACTIVE (revoca a effetto immediato), e che possieda TUTTI gli scopi richiesti
 * dalla rotta via @RequiredScopes.
 */
@Injectable()
export class ServiceAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: ServiceTokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IncomingRequest>();
    const token = this.extractBearer(request);
    if (!token) {
      throw new UnauthorizedException('Token di servizio mancante');
    }

    let claims;
    try {
      claims = this.tokens.verify(token);
    } catch {
      throw new UnauthorizedException('Token di servizio non valido o scaduto');
    }

    // Il client deve esistere ed essere ancora ACTIVE: così una revoca ha
    // effetto immediato anche su token non ancora scaduti.
    const client = await this.prisma.integrationClient.findUnique({
      where: { clientId: claims.sub },
      select: { tenantId: true, status: true, scopes: true },
    });
    if (!client || client.status !== 'ACTIVE') {
      throw new UnauthorizedException('Client di integrazione non attivo');
    }
    if (client.tenantId !== claims.tenantId) {
      throw new UnauthorizedException('Tenant del token incoerente con il client');
    }

    // Scopi effettivi: intersezione tra quelli nel token e quelli attuali del
    // client (il client potrebbe aver perso scopi dopo l'emissione del token).
    const effectiveScopes = (claims.scopes as IntegrationScope[]).filter((s) =>
      client.scopes.includes(s),
    );

    const required = this.reflector.getAllAndOverride<IntegrationScope[] | undefined>(
      REQUIRED_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (required && required.length > 0) {
      const missing = required.filter((s) => !effectiveScopes.includes(s));
      if (missing.length > 0) {
        throw new ForbiddenException(`Scopi mancanti: ${missing.join(', ')}`);
      }
    }

    const serviceContext: ServiceContext = {
      tenantId: client.tenantId,
      clientId: claims.sub,
      scopes: effectiveScopes,
      correlationId: this.correlationId(request),
    };
    request[SERVICE_CONTEXT_KEY] = serviceContext;
    return true;
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
