import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import { AUTH_CONTEXT_KEY, type AuthContext } from './auth-context.js';
import { ROLES_KEY } from './roles.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

/**
 * Gerarchia dei ruoli: un ruolo più alto soddisfa i requisiti di uno più basso
 * (Requisito 1.1 / 1.3). OWNER ⊇ ADMIN ⊇ EDITOR ⊇ VIEWER.
 */
const ROLE_RANK: Record<UserRole, number> = {
  OWNER: 3,
  ADMIN: 2,
  EDITOR: 1,
  VIEWER: 0,
};

/**
 * Guard di autorizzazione per ruolo. Si applica dopo AuthGuard (che ha già
 * popolato l'AuthContext). Se la rotta non dichiara @Roles, basta essere
 * autenticati.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ [AUTH_CONTEXT_KEY]?: AuthContext }>();
    const auth = request[AUTH_CONTEXT_KEY];
    if (!auth) {
      // AuthGuard non ha popolato il contesto: nega.
      throw new ForbiddenException('Contesto di autenticazione assente');
    }

    const userRank = ROLE_RANK[auth.role];
    const minRequired = Math.min(...required.map((r) => ROLE_RANK[r]));
    if (userRank < minRequired) {
      throw new ForbiddenException('Ruolo non autorizzato per questa operazione');
    }
    return true;
  }
}
