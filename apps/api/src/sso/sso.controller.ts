import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ServiceAuthGuard } from '../integration/service-auth.guard.js';
import { CurrentService, type ServiceContext } from '../integration/service-context.js';
import { RequiredScopes } from '../integration/required-scopes.decorator.js';
import { INTEGRATION_SCOPES } from '../integration/integration-scopes.js';
import { SsoService } from './sso.service.js';
import { IssueTicketSchema, RedeemTicketSchema, type IssueTicketInput, type RedeemTicketInput } from './dto.js';

/**
 * SSO via ticket (Scenario 2).
 *
 * - POST /sso/ticket : chiamato dalla TERZA PARTE (API key + scope sso:issue).
 *   Provisiona l'utente nel tenant della API key e restituisce un ticket + un
 *   redirectUrl verso la nostra web app.
 * - POST /sso/redeem : chiamato dalla NOSTRA WEB APP con il ticket, per ottenere
 *   un token di sessione utente. Pubblico (il ticket è la credenziale monouso).
 */
@Controller('sso')
export class SsoController {
  constructor(private readonly sso: SsoService) {}

  @Public()
  @UseGuards(ServiceAuthGuard)
  @RequiredScopes(INTEGRATION_SCOPES.SSO_ISSUE)
  @Post('ticket')
  issueTicket(
    @CurrentService() svc: ServiceContext,
    @Body(new ZodValidationPipe(IssueTicketSchema)) body: IssueTicketInput,
  ) {
    return this.sso.issueTicket(svc.tenantId, svc.clientId, body);
  }

  @Public()
  @Post('redeem')
  async redeem(@Body(new ZodValidationPipe(RedeemTicketSchema)) body: RedeemTicketInput) {
    const result = await this.sso.redeemTicket(body.ticket);
    return {
      access_token: result.accessToken,
      token_type: result.tokenType,
      expires_in: result.expiresInSec,
      user: result.user,
      tenant: result.tenant,
    };
  }
}
