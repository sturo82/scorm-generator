import { Controller, Get } from '@nestjs/common';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { AuditService } from './audit.service.js';

/** Consultazione dell'audit trail del tenant (Requisito 11.3). Solo ADMIN+. */
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles('ADMIN')
  list(@CurrentContext() ctx: AuthContext) {
    return this.audit.list(ctx.tenant.tenantId);
  }
}
