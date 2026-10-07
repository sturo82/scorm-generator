import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Accesso ai dati scoped per tenant (Requisito 1.2 / 12.5).
 *
 * Isolamento a due strati:
 *  1. Applicativo (primario): le operazioni passano da qui, che esegue tutto
 *     dentro una transazione in cui viene impostata la GUC `app.current_tenant`.
 *     I repository ricevono un client transazionale e aggiungono comunque il
 *     filtro `tenantId` esplicito nelle query.
 *  2. Database (difesa in profondità): le policy Row-Level Security filtrano le
 *     righe in base a `app.current_tenant`, così anche una query che dimentica
 *     il filtro non può leggere/scrivere dati di altri tenant.
 */
@Injectable()
export class TenantPrismaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Esegue `fn` in una transazione con la GUC `app.current_tenant` impostata al
   * tenant indicato. `SET LOCAL` limita l'effetto alla transazione corrente.
   */
  async runInTenant<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      // set_config(name, value, is_local=true) == SET LOCAL, con binding
      // parametrico sicuro contro injection.
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
      return fn(tx);
    });
  }
}
