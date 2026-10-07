import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard.js';
import { AUTH_CONTEXT_KEY, type AuthContext } from './auth-context.js';
import { ROLES_KEY } from './roles.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

/** Costruisce un ExecutionContext fittizio con la request e i metadati dati. */
function makeContext(opts: {
  role?: UserRole;
  roles?: UserRole[];
  isPublic?: boolean;
}): { reflector: Reflector; ctx: ExecutionContext } {
  const request: { [AUTH_CONTEXT_KEY]?: AuthContext } = {};
  if (opts.role) {
    request[AUTH_CONTEXT_KEY] = {
      tenant: { tenantId: 't1' },
      userId: 'u1',
      role: opts.role,
      correlationId: 'c1',
    };
  }

  const reflector = {
    getAllAndOverride: (key: string) => {
      if (key === IS_PUBLIC_KEY) return opts.isPublic ?? false;
      if (key === ROLES_KEY) return opts.roles;
      return undefined;
    },
  } as unknown as Reflector;

  const ctx = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { reflector, ctx };
}

describe('RolesGuard', () => {
  it('consente le rotte pubbliche', () => {
    const { reflector, ctx } = makeContext({ isPublic: true });
    expect(new RolesGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('consente se nessun ruolo è richiesto (solo autenticazione)', () => {
    const { reflector, ctx } = makeContext({ role: 'VIEWER' });
    expect(new RolesGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('consente un EDITOR dove è richiesto EDITOR', () => {
    const { reflector, ctx } = makeContext({ role: 'EDITOR', roles: ['EDITOR'] });
    expect(new RolesGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('consente un OWNER dove è richiesto EDITOR (gerarchia)', () => {
    const { reflector, ctx } = makeContext({ role: 'OWNER', roles: ['EDITOR'] });
    expect(new RolesGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('nega un VIEWER dove è richiesto EDITOR', () => {
    const { reflector, ctx } = makeContext({ role: 'VIEWER', roles: ['EDITOR'] });
    expect(() => new RolesGuard(reflector).canActivate(ctx)).toThrow(/non autorizzato/i);
  });

  it('nega se manca il contesto di autenticazione', () => {
    const { reflector, ctx } = makeContext({ roles: ['VIEWER'] });
    expect(() => new RolesGuard(reflector).canActivate(ctx)).toThrow(/assente/i);
  });
});
