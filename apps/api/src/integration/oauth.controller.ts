import { Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { IntegrationClientsService } from './integration-clients.service.js';
import { TokenRequestSchema, type TokenRequest } from './dto.js';

/**
 * Endpoint OAuth2 per le integrazioni B2B. Pubblico (fuori dall'auth utente):
 * le credenziali sono il clientId/clientSecret del flusso client-credentials,
 * non un bearer utente. Emette un access token di servizio.
 *
 * Accetta sia JSON sia application/x-www-form-urlencoded (standard OAuth2).
 */
@Controller('oauth')
export class OAuthController {
  constructor(private readonly clients: IntegrationClientsService) {}

  @Public()
  @Post('token')
  async token(@Body(new ZodValidationPipe(TokenRequestSchema)) body: TokenRequest) {
    try {
      const result = await this.clients.issueToken(body.client_id, body.client_secret);
      // Forma di risposta conforme a OAuth2 (snake_case).
      return {
        access_token: result.accessToken,
        token_type: result.tokenType,
        expires_in: result.expiresInSec,
        scope: result.scopes.join(' '),
      };
    } catch {
      // Risposta OAuth2 standard: non rivelare quale credenziale è errata.
      throw new UnauthorizedException({ error: 'invalid_client' });
    }
  }
}
