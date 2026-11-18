import { Body, Controller, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import { PricingQuoteInput, type PricingQuoteInput as PricingQuoteInputType } from '@scorm/contracts';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CostService } from './cost.service.js';
import { WalletService } from '../ecosystem/wallet.service.js';

/**
 * API costi/pricing di un corso (Requisito costi): consuntivo misurato e
 * preventivo cliente con markup. Richiede ruolo EDITOR (chi gestisce il corso
 * vede i costi); l'esposizione del prezzo di vendita è una scelta di business
 * del tenant, non un dato cross-tenant.
 */
@Controller('courses/:courseId/cost')
@Roles('EDITOR')
export class CostController {
  constructor(
    private readonly cost: CostService,
    private readonly wallet: WalletService,
  ) {}
  /** Con i crediti attivi il cliente vede solo i crediti: i costi dei fornitori e il margine restano interni. */
  private async assertInternal(): Promise<void> {
    if (await this.wallet.isEnabled()) throw new ForbiddenException('Costi in dollari non disponibili: vedi i crediti del corso');
  }

  /** Costo consuntivo del corso: breakdown per sorgente + totale provider. */
  @Get()
  async summary(@CurrentContext() ctx: AuthContext, @Param('courseId') courseId: string) {
    await this.assertInternal();
    return this.cost.courseCostSummary(ctx.tenant.tenantId, courseId);
  }

  /** Preventivo cliente: applica markup/buffer/fee al costo consuntivo. */
  @Post('quote')
  async quote(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Body(new ZodValidationPipe(PricingQuoteInput)) input: PricingQuoteInputType,
  ) {
    await this.assertInternal();
    return this.cost.courseQuote(ctx.tenant.tenantId, courseId, input);
  }
}
