import { describe, it, expect, vi } from 'vitest';
import { AuditService } from './audit.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuthContext } from '../auth/auth-context.js';

const ctx: AuthContext = {
  tenant: { tenantId: 't1' },
  userId: 'u1',
  role: 'ADMIN',
  correlationId: 'corr-1',
};

describe('AuditService', () => {
  it('registra un evento con tenant, utente e correlation id', async () => {
    const create = vi.fn(async () => ({}));
    const prisma = { auditEvent: { create } } as unknown as PrismaService;
    const svc = new AuditService(prisma);

    await svc.record(ctx, { action: 'course.export', resourceType: 'course', resourceId: 'c1' });

    const data = create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data.tenantId).toBe('t1');
    expect(data.userId).toBe('u1');
    expect(data.action).toBe('course.export');
    expect(data.correlationId).toBe('corr-1');
  });

  it('non propaga errori se la scrittura audit fallisce', async () => {
    const create = vi.fn(async () => {
      throw new Error('db down');
    });
    const prisma = { auditEvent: { create } } as unknown as PrismaService;
    const svc = new AuditService(prisma);
    // Non deve lanciare: l'audit non deve mai bloccare l'operazione principale.
    await expect(
      svc.record(ctx, { action: 'x', resourceType: 'y' }),
    ).resolves.toBeUndefined();
  });
});
