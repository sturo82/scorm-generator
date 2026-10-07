import { Controller, Get, Param } from '@nestjs/common';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { GenerationService } from './generation.service.js';

/**
 * API di stato dei job di generazione AI (polling). Le generazioni sono
 * asincrone: il client avvia un job (202 + jobId) e interroga questi endpoint
 * finché lo stato non è COMPLETED/FAILED. Tutto isolato per tenant+corso.
 */
@Controller('courses/:courseId/jobs')
@Roles('EDITOR')
export class JobsController {
  constructor(private readonly generation: GenerationService) {}

  /** Job attivi (QUEUED/RUNNING) del corso: utile per riflettere "AI al lavoro". */
  @Get()
  listActive(@CurrentContext() ctx: AuthContext, @Param('courseId') courseId: string) {
    return this.generation.listActiveJobs(ctx.tenant.tenantId, courseId);
  }

  /** Stato di un singolo job. */
  @Get(':jobId')
  get(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Param('jobId') jobId: string,
  ) {
    return this.generation.getJob(ctx.tenant.tenantId, courseId, jobId);
  }
}
