import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Wrapper NestJS sul PrismaClient con gestione del ciclo di vita della
 * connessione. L'isolamento multi-tenant è applicato a livello di query (filtro
 * tenantId) e rafforzato da Row-Level Security (vedi migrazione RLS).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
