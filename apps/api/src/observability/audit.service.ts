import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthContext } from '../auth/auth-context.js';

export interface AuditInput {
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Audit trail delle azioni rilevanti (Requisito 11.3): creazione, modifica,
 * esportazione, eliminazione. Ogni evento registra utente, tenant, correlation
 * id e timestamp. La scrittura dell'audit non deve mai far fallire l'operazione
 * principale: gli errori vengono loggati ma non propagati.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(ctx: AuthContext, input: AuditInput): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          tenantId: ctx.tenant.tenantId,
          userId: ctx.userId,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          correlationId: ctx.correlationId,
          metadata: (input.metadata ?? {}) as object,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'errore audit';
      this.logger.error(`Audit non registrato (${input.action}): ${message}`);
    }
  }

  async list(tenantId: string, limit = 100) {
    return this.prisma.auditEvent.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
    });
  }
}
