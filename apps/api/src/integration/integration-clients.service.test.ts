import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { IntegrationClientsService } from './integration-clients.service.js';
import { ServiceTokenService } from './service-token.service.js';
import type { AppConfig } from '../config/configuration.js';

const integrationConfig: AppConfig['integration'] = {
  jwtSecret: 'test-integration-secret',
  issuer: 'scorm-generator',
  audience: 'scorm-integration',
  tokenTtlSec: 3600,
};

const tokens = new ServiceTokenService({
  get: () => integrationConfig,
} as unknown as ConstructorParameters<typeof ServiceTokenService>[0]);

/** Prisma finto in-memory per integrationClient. */
interface Row {
  id: string;
  tenantId: string;
  name: string;
  clientId: string;
  secretHash: string;
  scopes: string[];
  status: 'ACTIVE' | 'REVOKED';
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function makePrisma() {
  const rows: Row[] = [];
  let seq = 0;
  return {
    rows,
    integrationClient: {
      create: async ({ data }: { data: Partial<Row> }) => {
        const row: Row = {
          id: `ic_${++seq}`,
          tenantId: data.tenantId!,
          name: data.name!,
          clientId: data.clientId!,
          secretHash: data.secretHash!,
          scopes: data.scopes ?? [],
          status: (data.status as 'ACTIVE') ?? 'ACTIVE',
          lastUsedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        rows.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { clientId: string } }) =>
        rows.find((r) => r.clientId === where.clientId) ?? null,
      findFirst: async ({ where }: { where: { id?: string; tenantId?: string } }) =>
        rows.find(
          (r) =>
            (where.id === undefined || r.id === where.id) &&
            (where.tenantId === undefined || r.tenantId === where.tenantId),
        ) ?? null,
      findMany: async ({ where }: { where: { tenantId: string } }) =>
        rows.filter((r) => r.tenantId === where.tenantId),
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const i = rows.findIndex((r) => r.id === where.id);
        rows.splice(i, 1);
      },
    },
  };
}

describe('IntegrationClientsService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: IntegrationClientsService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new IntegrationClientsService(prisma as never, tokens);
  });

  it('crea un client con scopi di default e mostra il secret una sola volta', async () => {
    const created = await svc.create('tenant-1', { name: 'OnDemand' });
    expect(created.clientId).toMatch(/^oc_/);
    expect(created.clientSecret).toMatch(/^os_/);
    expect(created.scopes).toEqual(['catalog:read', 'package:download']);
    // La vista di lista non espone il secret.
    const list = await svc.list('tenant-1');
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('clientSecret');
  });

  it('rifiuta scopi non riconosciuti', async () => {
    await expect(
      svc.create('tenant-1', { name: 'X', scopes: ['catalog:read', 'inventato:scope'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('emette un token valido con client_credentials corretti', async () => {
    const created = await svc.create('tenant-1', { name: 'OnDemand' });
    const result = await svc.issueToken(created.clientId, created.clientSecret);
    expect(result.tokenType).toBe('Bearer');
    const claims = tokens.verify(result.accessToken);
    expect(claims.tenantId).toBe('tenant-1');
    expect(claims.scopes).toEqual(['catalog:read', 'package:download']);
    // lastUsedAt aggiornato.
    expect(prisma.rows[0].lastUsedAt).toBeInstanceOf(Date);
  });

  it('rifiuta credenziali errate', async () => {
    const created = await svc.create('tenant-1', { name: 'OnDemand' });
    await expect(svc.issueToken(created.clientId, 'secret-sbagliato')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(svc.issueToken('oc_inesistente', 'qualsiasi')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('un client revocato non emette più token', async () => {
    const created = await svc.create('tenant-1', { name: 'OnDemand' });
    await svc.revoke('tenant-1', created.id);
    await expect(svc.issueToken(created.clientId, created.clientSecret)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
