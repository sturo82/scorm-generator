import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { IntegrationClientsService } from './integration-clients.service.js';
import { ALL_INTEGRATION_SCOPES } from './integration-scopes.js';
import { CreateIntegrationClientSchema, type CreateIntegrationClient } from './dto.js';

/**
 * Gestione dei client di integrazione lato tenant (web app). Richiede ruolo
 * ADMIN o superiore: autorizzare una piattaforma terza ad accedere al catalogo
 * è un'azione sensibile. Il clientSecret è mostrato in chiaro SOLO alla
 * creazione e non è più recuperabile dopo.
 */
@Controller('integration/clients')
export class IntegrationClientsController {
  constructor(private readonly clients: IntegrationClientsService) {}

  /** Scopi disponibili, per popolare la UI di creazione. */
  @Get('scopes')
  @Roles('ADMIN')
  availableScopes() {
    return { scopes: ALL_INTEGRATION_SCOPES };
  }

  @Get()
  @Roles('ADMIN')
  list(@CurrentContext() ctx: AuthContext) {
    return this.clients.list(ctx.tenant.tenantId);
  }

  @Post()
  @Roles('ADMIN')
  create(
    @CurrentContext() ctx: AuthContext,
    @Body(new ZodValidationPipe(CreateIntegrationClientSchema)) dto: CreateIntegrationClient,
  ) {
    return this.clients.create(ctx.tenant.tenantId, dto);
  }

  /** Revoca (soft): blocca l'emissione di nuovi token e le richieste in corso. */
  @Post(':id/revoke')
  @Roles('ADMIN')
  revoke(@CurrentContext() ctx: AuthContext, @Param('id') id: string) {
    return this.clients.revoke(ctx.tenant.tenantId, id);
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@CurrentContext() ctx: AuthContext, @Param('id') id: string) {
    await this.clients.delete(ctx.tenant.tenantId, id);
    return { deleted: true };
  }
}
