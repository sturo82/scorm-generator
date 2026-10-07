import { Controller, Get } from '@nestjs/common';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { GenerationService } from './generation.service.js';

/**
 * Elenco tenant-wide dei corsi con generazione AI attiva, aggregato per corso.
 * Alimenta il badge "in generazione" nella lista corsi e nell'header, senza
 * interrogare ogni corso singolarmente. Isolato per tenant.
 */
@Controller('jobs')
@Roles('EDITOR')
export class ActiveJobsController {
  constructor(private readonly generation: GenerationService) {}

  /** Corsi del tenant con job QUEUED/RUNNING + conteggio job attivi. */
  @Get('active')
  active(@CurrentContext() ctx: AuthContext) {
    return this.generation.listActiveCourseIds(ctx.tenant.tenantId);
  }
}
