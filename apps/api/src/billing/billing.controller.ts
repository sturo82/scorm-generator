import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BillingService } from './billing.service.js';

const QuoteBody = z.object({
  items: z
    .array(z.object({ feature: z.string().min(1).max(60), units: z.number().positive().max(100000).optional() }))
    .min(1)
    .max(30),
});
type QuoteBodyType = z.infer<typeof QuoteBody>;

/** Wallet a crediti e preventivi: saldo, link di ricarica e costo di una generazione. */
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** Stato del wallet dell'azienda (saldo solo se l'addebito è attivo). */
  @Get('wallet')
  async wallet(@CurrentContext() ctx: AuthContext) {
    const view = await this.billing.walletView(ctx.tenant.tenantId);
    // La ricarica è riservata all'owner dell'azienda.
    return { ...view, canTopup: ctx.role === 'OWNER' };
  }

  /** Preventivo in crediti di una generazione, con `billed` per sapere se verrà addebitata. */
  @Post('quote')
  async quote(@CurrentContext() ctx: AuthContext, @Body(new ZodValidationPipe(QuoteBody)) body: QuoteBodyType) {
    const [billed, quote] = [await this.billing.isBilled(ctx.tenant.tenantId), this.billing.quote(body.items)];
    return { billed, ...quote };
  }
}
