import { Module } from '@nestjs/common';
import { ExportModule } from '../export/export.module.js';
import { ServiceTokenService } from './service-token.service.js';
import { IntegrationClientsService } from './integration-clients.service.js';
import { CatalogService } from './catalog.service.js';
import { ServiceAuthGuard } from './service-auth.guard.js';
import { OAuthController } from './oauth.controller.js';
import { CatalogController } from './catalog.controller.js';
import { IntegrationClientsController } from './integration-clients.controller.js';

/**
 * Integrazioni B2B (macchina-a-macchina): client-credentials OAuth2 + catalogo
 * dei corsi condivisibili. OBJECT_STORAGE e PrismaService arrivano dai moduli
 * globali; ExportService dall'ExportModule (per costruire pacchetti on demand).
 */
@Module({
  imports: [ExportModule],
  controllers: [OAuthController, CatalogController, IntegrationClientsController],
  providers: [ServiceTokenService, IntegrationClientsService, CatalogService, ServiceAuthGuard],
  exports: [ServiceTokenService, ServiceAuthGuard],
})
export class IntegrationModule {}
