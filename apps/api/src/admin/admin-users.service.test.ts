import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, ForbiddenException, NotImplementedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AdminUsersService } from './admin-users.service.js';
import * as cognito from './cognito.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantPrismaService } from '../tenancy/tenant-prisma.service.js';
import type { AuditService } from '../observability/audit.service.js';
import type { ConfigService } from '@nestjs/config';
import type { AuthContext } from '../auth/auth-context.js';

vi.mock('./cognito.js', async () => {
  const actual = await vi.importActual<typeof import('./cognito.js')>('./cognito.js');
  return { ...actual, adminCreateUser: vi.fn(), adminDeleteUser: vi.fn() };
});

const mockedCreate = vi.mocked(cognito.adminCreateUser);
const mockedDelete = vi.mocked(cognito.adminDeleteUser);

const ctx = (role: AuthContext['role']): AuthContext => ({
  tenant: { tenantId: 'tenant-1' },
  userId: 'admin-1',
  role,
  correlationId: 'c1',
});

function makeService(opts?: {
  userPoolId?: string | undefined;
  createImpl?: (args: { data: Record<string, unknown> }) => Promise<unknown>;
}) {
  const userCreate = vi.fn(
    opts?.createImpl ??
      (async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'user-1',
        email: data.email,
        displayName: data.displayName ?? null,
        role: data.role,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      })),
  );
  const findMany = vi.fn(async () => [
    { id: 'user-1', email: 'a@x.com', displayName: null, role: 'OWNER', createdAt: new Date('2026-01-01T00:00:00Z') },
  ]);
  const prisma = { user: { findMany } } as unknown as PrismaService;
  const tenantPrisma = {
    runInTenant: vi.fn(async (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ user: { create: userCreate } }),
    ),
  } as unknown as TenantPrismaService;
  const audit = { record: vi.fn(async () => undefined) } as unknown as AuditService;
  const config = {
    get: () => ({ userPoolId: opts && 'userPoolId' in opts ? opts.userPoolId : 'pool-1', region: 'eu-west-1' }),
  } as unknown as ConfigService<never, true>;
  const client = {} as never;
  const svc = new AdminUsersService(prisma, tenantPrisma, audit, config, client);
  return { svc, userCreate, findMany, audit };
}

describe('AdminUsersService.createUser', () => {
  beforeEach(() => {
    mockedCreate.mockReset();
    mockedDelete.mockReset();
  });

  it('crea in Cognito con custom:tenant_id dal ctx, poi il record DB, poi audit', async () => {
    mockedCreate.mockResolvedValue({ sub: 'sub-123' });
    const { svc, userCreate, audit } = makeService();
    const res = await svc.createUser(ctx('OWNER'), { email: 'New@X.com', role: 'EDITOR' });

    // Cognito chiamato con email normalizzata e tenant dal ctx.
    expect(mockedCreate).toHaveBeenCalledWith(expect.anything(), {
      userPoolId: 'pool-1',
      email: 'new@x.com',
      tenantId: 'tenant-1',
    });
    // Record DB creato con externalId = sub e tenant dal ctx.
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: 'tenant-1', externalId: 'sub-123', email: 'new@x.com', role: 'EDITOR' }),
      }),
    );
    expect(audit.record).toHaveBeenCalled();
    expect(res).toMatchObject({ id: 'user-1', role: 'EDITOR' });
  });

  it('un ADMIN non può creare un OWNER (403) e NON tocca Cognito', async () => {
    const { svc } = makeService();
    await expect(svc.createUser(ctx('ADMIN'), { email: 'x@x.com', role: 'OWNER' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('email duplicata nel tenant → 409 e compensa su Cognito', async () => {
    mockedCreate.mockResolvedValue({ sub: 'sub-dup' });
    mockedDelete.mockResolvedValue(undefined);
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
    const { svc } = makeService({ createImpl: async () => { throw p2002; } });
    await expect(svc.createUser(ctx('OWNER'), { email: 'dup@x.com', role: 'VIEWER' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    // Compensazione: utente Cognito eliminato.
    expect(mockedDelete).toHaveBeenCalledWith(expect.anything(), 'pool-1', 'dup@x.com');
  });

  it('se Cognito dice UserExists → 409 (nessuna create DB)', async () => {
    mockedCreate.mockRejectedValue(new cognito.CognitoUserExistsError());
    const { svc, userCreate } = makeService();
    await expect(svc.createUser(ctx('OWNER'), { email: 'exists@x.com', role: 'VIEWER' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('se Cognito non è configurato → 501', async () => {
    const { svc } = makeService({ userPoolId: undefined });
    await expect(svc.createUser(ctx('OWNER'), { email: 'x@x.com', role: 'VIEWER' })).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });
});

describe('AdminUsersService.listUsers', () => {
  it('elenca gli utenti del solo tenant del ctx', async () => {
    const { svc } = makeService();
    const list = await svc.listUsers(ctx('ADMIN'));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'user-1', role: 'OWNER' });
  });
});
