import { Module } from '@nestjs/common';
import { IntegrationModule } from '../integration/integration.module.js';
import { UserTokenService } from './user-token.service.js';
import { SsoService } from './sso.service.js';
import { SsoController } from './sso.controller.js';

/**
 * SSO via ticket (Scenario 2). Importa IntegrationModule per riusare la
 * ServiceAuthGuard (il ticket è emesso dalla terza parte con la sua API key).
 * Espone UserTokenService così che l'AuthGuard possa validare i token utente SSO.
 */
@Module({
  imports: [IntegrationModule],
  controllers: [SsoController],
  providers: [UserTokenService, SsoService],
  exports: [UserTokenService],
})
export class SsoModule {}
