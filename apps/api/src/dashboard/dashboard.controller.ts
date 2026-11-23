import { Controller, Get } from '@nestjs/common';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { DashboardService } from './dashboard.service.js';

/** Dashboard dell'utente: numeri, corsi recenti con copertina e consumo di crediti. */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  summary(@CurrentContext() ctx: AuthContext) {
    return this.dashboard.summary(ctx.tenant.tenantId, ctx.userId);
  }
}
