import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SsoService } from './sso.service.js';
import { UserTokenService } from './user-token.service.js';
import type { AppConfig } from '../config/configuration.js';

const ssoConfig: AppConfig['sso'] = {
  userJwtSecret: 'test-sso-user-secret',
  issuer: 'scorm-generator',
  audience: 'scorm-webapp',
  userTokenTtlSec: 28800,
  ticketTtlSec: 60,
  maxRole: 'ADMIN',
};

const config = {
  get: (key: string) => (key === 'sso' ? ssoConfig : 'http://localhost:3100'),
} as unknown as ConstructorParameters<typeof UserTokenService>[0];

const userTokens = new UserTokenService(config);

interface UserRow {
  id: string;
  tenantId: string;
  externalId: string;
  email: string;
  displayName: string | null;
  role: string;
}
interface TicketRow {
  tokenHash: string;
  tenantId: string;
  userId: string;
  clientId: string;
  expiresAt: Date;
  usedAt: Date | null;
}

function makeStores() {
  const users: UserRow[] = [];
  const tickets: TicketRow[] = [];
  let userSeq = 0;

  const tx = {
    user: {
      upsert: async ({
        where,
        update,
        create,
      }: {
        where: { tenantId_externalId: { tenantId: string; externalId: string } };
        update: Partial<UserRow>;
        create: UserRow;
      }) => {
        const key = where.tenantId_externalId;
        let u = users.find((x) => x.tenantId === key.tenantId && x.externalId === key.externalId);
        if (u) {
          Object.assign(u, update);
        } else {
          u = { ...create, id: `u_${++userSeq}` };
          users.push(u);
        }
        return { id: u.id };
      },
    },
    ssoTicket: {
      create: async ({ data }: { data: Omit<TicketRow, 'usedAt'> }) => {
        tickets.push({ ...data, usedAt: null });
        return data;
      },
    },
  };

  const prisma = {
    ssoTicket: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        const t = tickets.find((x) => x.tokenHash === where.tokenHash);
        if (!t) return null;
        const u = users.find((x) => x.id === t.userId)!;
        return { ...t, user: { ...u } };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { tokenHash: string; usedAt: null };
        data: { usedAt: Date };
      }) => {
        const t = tickets.find((x) => x.tokenHash === where.tokenHash && x.usedAt === null);
        if (!t) return { count: 0 };
        t.usedAt = data.usedAt;
        return { count: 1 };
      },
    },
  };

  const tenantPrisma = {
    runInTenant: async <T>(_tenantId: string, fn: (t: typeof tx) => Promise<T>) => fn(tx),
  };

  return { users, tickets, prisma, tenantPrisma };
}

describe('SsoService', () => {
  let stores: ReturnType<typeof makeStores>;
  let svc: SsoService;

  beforeEach(() => {
    stores = makeStores();
    svc = new SsoService(
      stores.prisma as never,
      stores.tenantPrisma as never,
      userTokens,
      config as never,
    );
  });

  it('emette un ticket provisioning-ando l’utente JIT nel tenant', async () => {
    const res = await svc.issueTicket('tenant-1', 'oc_client', {
      email: 'Mario@OnDemand.test',
      displayName: 'Mario Rossi',
      role: 'EDITOR',
    });
    expect(res.ticket).toBeTruthy();
    expect(res.redirectUrl).toContain('/sso?ticket=');
    // Utente creato con email normalizzata e ruolo richiesto.
    expect(stores.users).toHaveLength(1);
    expect(stores.users[0].email).toBe('mario@ondemand.test');
    expect(stores.users[0].role).toBe('EDITOR');
    // Ticket salvato come hash, non in chiaro.
    const expectedHash = createHash('sha256').update(res.ticket).digest('hex');
    expect(stores.tickets[0].tokenHash).toBe(expectedHash);
  });

  it('rifiuta un ruolo oltre il massimo consentito (mai OWNER)', async () => {
    await expect(
      svc.issueTicket('tenant-1', 'oc_client', { email: 'a@b.c', role: 'OWNER' as never }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('redeem scambia il ticket con un token utente valido (una sola volta)', async () => {
    const { ticket } = await svc.issueTicket('tenant-1', 'oc_client', {
      email: 'a@b.c',
      role: 'VIEWER',
    });
    const res = await svc.redeemTicket(ticket);
    expect(res.tokenType).toBe('Bearer');
    const claims = userTokens.verify(res.accessToken);
    expect(claims.tenantId).toBe('tenant-1');
    expect(claims.kind).toBe('user');
    // Secondo redeem: fallisce (monouso).
    await expect(svc.redeemTicket(ticket)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('redeem rifiuta un ticket inesistente', async () => {
    await expect(svc.redeemTicket('inesistente')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('redeem rifiuta un ticket scaduto', async () => {
    const { ticket } = await svc.issueTicket('tenant-1', 'oc_client', {
      email: 'a@b.c',
      role: 'VIEWER',
    });
    // Forza la scadenza nel passato.
    stores.tickets[0].expiresAt = new Date(Date.now() - 1000);
    await expect(svc.redeemTicket(ticket)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
