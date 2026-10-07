import { Global, Module } from '@nestjs/common';
import { TenantPrismaService } from './tenant-prisma.service.js';

@Global()
@Module({
  providers: [TenantPrismaService],
  exports: [TenantPrismaService],
})
export class TenancyModule {}
