import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PricingQuoteInput, type PricingQuoteInput as PricingQuoteInputType } from '@scorm/contracts';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CostService } from './cost.service.js';

/**
 * API costi/pricing di un corso (Requisito costi): consuntivo misurato e
 * preventivo cliente con markup. Richiede ruolo EDITOR (chi gestisce il corso
 * vede i costi); l'esposizione del prezzo di vendita è una scelta di business
 * del tenant, non un dato cross-tenant.
 */
@Controller('courses/:courseId/cost')
@Roles('EDITOR')
export class CostController {
  constructor(private readonly cost: CostService) {}

  /** Costo consuntivo del corso: breakdown per sorgente + totale provider. */
  @Get()
  summary(@CurrentContext() ctx: AuthContext, @Param('courseId') courseId: string) {
    return this.cost.courseCostSummary(ctx.tenant.tenantId, courseId);
  }

  /** Preventivo cliente: applica markup/buffer/fee al costo consuntivo. */
  @Post('quote')
  quote(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Body(new ZodValidationPipe(PricingQuoteInput)) input: PricingQuoteInputType,
  ) {
    return this.cost.courseQuote(ctx.tenant.tenantId, courseId, input);
  }
}
