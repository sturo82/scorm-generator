import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CourseEstimateInput, CourseEstimateOptions, type CourseEstimateInput as CourseEstimateInputType } from '@scorm/contracts';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BillingService } from './billing.service.js';

const QuoteBody = z.object({
  items: z
    .array(z.object({ feature: z.string().min(1).max(60), units: z.number().positive().max(100000).optional() }))
    .min(1)
    .max(30),
});
type QuoteBodyType = z.infer<typeof QuoteBody>;

const PayerBody = z.object({ payer: z.enum(['COMPANY', 'PERSONAL']) });
type PayerBodyType = z.infer<typeof PayerBody>;

const TxQuery = z.object({
  wallet: z.enum(['company', 'personal']),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
type TxQueryType = z.infer<typeof TxQuery>;
const ConfirmBudgetBody = z.object({ options: CourseEstimateOptions.partial().optional() });
type ConfirmBudgetBodyType = z.infer<typeof ConfirmBudgetBody>;
/** Importi di ricarica del wallet personale consentiti (euro; 1 EUR = 100 crediti). */
const TopupBody = z.object({ amountEur: z.number().int().min(5).max(500) });
type TopupBodyType = z.infer<typeof TopupBody>;

/** Wallet a crediti e preventivi: saldi, scelta di chi paga, ricarica e costo di una generazione. */
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** Stato dei wallet (azienda e personale) e di chi paga le generazioni. */
  @Get('wallet')
  wallet(@CurrentContext() ctx: AuthContext) {
    return this.billing.walletView(ctx.tenant.tenantId, ctx.userId, ctx.role);
  }

  /** Crediti addebitati per un corso (quanto ha pagato il cliente, senza costi dei fornitori). */
  @Get('courses/:courseId')
  courseCredits(@CurrentContext() ctx: AuthContext, @Param('courseId') courseId: string) {
    return this.billing.courseCredits(ctx.tenant.tenantId, courseId);
  }
  /** Preventivo (tetto garantito) di un corso da creare, dal piano del brief. */
  @Post('estimate')
  estimate(@CurrentContext() ctx: AuthContext, @Body(new ZodValidationPipe(CourseEstimateInput)) body: CourseEstimateInputType) {
    return this.billing.estimateCourse(ctx.tenant.tenantId, body);
  }
  /** Quanto manca per completare un corso esistente (struttura, lezioni vuote, test previsti). */
  @Get('estimate/courses/:courseId')
  estimateExisting(@CurrentContext() ctx: AuthContext, @Param('courseId') courseId: string) {
    return this.billing.estimateExistingCourse(ctx.tenant.tenantId, courseId);
  }
  /** Prezzi massimi delle operazioni di una lezione, per i pulsanti. */
  @Get('estimate/courses/:courseId/lessons/:lessonId')
  estimateLesson(@CurrentContext() ctx: AuthContext, @Param('courseId') courseId: string, @Param('lessonId') lessonId: string) {
    return this.billing.estimateLesson(ctx.tenant.tenantId, courseId, lessonId);
  }
  /**
   * Conferma il preventivo del corso (con le opzioni scelte): diventa il budget. Le spese che lo
   * supererebbero chiedono poi una conferma esplicita.
   */
  @Post('courses/:courseId/budget/confirm')
  @Roles('EDITOR')
  confirmBudget(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Body(new ZodValidationPipe(ConfirmBudgetBody)) body: ConfirmBudgetBodyType,
  ) {
    return this.billing.confirmBudget(ctx.tenant.tenantId, courseId, body.options);
  }
  /** Movimenti del wallet dell'azienda o personale (solo quelli che cambiano il saldo). */
  @Get('transactions')
  transactions(@CurrentContext() ctx: AuthContext, @Query(new ZodValidationPipe(TxQuery)) q: TxQueryType) {
    return this.billing.transactions(ctx.tenant.tenantId, ctx.userId, ctx.role, q.wallet, q.page);
  }
  /** Sceglie il wallet che paga le generazioni; il personale si attiva alla prima scelta. */
  @Put('payer')
  async setPayer(@CurrentContext() ctx: AuthContext, @Body(new ZodValidationPipe(PayerBody)) body: PayerBodyType) {
    await this.billing.setPayer(ctx.tenant.tenantId, ctx.userId, body.payer);
    return this.billing.walletView(ctx.tenant.tenantId, ctx.userId, ctx.role);
  }

  /** Avvia la ricarica del wallet personale: ritorna la pagina di pagamento Stripe. */
  @Post('topup')
  topup(@CurrentContext() ctx: AuthContext, @Body(new ZodValidationPipe(TopupBody)) body: TopupBodyType) {
    return this.billing.startPersonalTopup(ctx.tenant.tenantId, ctx.userId, body.amountEur);
  }

  /** Preventivo in crediti di una generazione, con `billed` per sapere se verrà addebitata. */
  @Post('quote')
  async quote(@CurrentContext() ctx: AuthContext, @Body(new ZodValidationPipe(QuoteBody)) body: QuoteBodyType) {
    const [billed, quote] = [await this.billing.isBilled(ctx.tenant.tenantId), this.billing.quote(body.items)];
    return { billed, ...quote };
  }
}
