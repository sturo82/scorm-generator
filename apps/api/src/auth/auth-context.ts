import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RequestContext } from '@scorm/domain';
import type { UserRole } from '@prisma/client';

/**
 * Contesto autenticato della richiesta. Estende il RequestContext del dominio
 * (tenant + correlationId + userId) con il ruolo dell'utente risolto dal DB,
 * usato per l'autorizzazione (Requisito 1.3).
 */
export interface AuthContext extends RequestContext {
  userId: string;
  role: UserRole;
}

/** Chiave con cui la guard allega il contesto alla request Express. */
export const AUTH_CONTEXT_KEY = 'authContext';

/**
 * Decorator per iniettare l'AuthContext nei controller:
 *   method(@CurrentContext() ctx: AuthContext) { ... }
 */
export const CurrentContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest<{ [AUTH_CONTEXT_KEY]?: AuthContext }>();
    const auth = request[AUTH_CONTEXT_KEY];
    if (!auth) {
      throw new Error('AuthContext assente: la rotta richiede AuthGuard');
    }
    return auth;
  },
);
