import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { IntegrationScope } from './integration-scopes.js';

/**
 * Contesto di una richiesta autenticata come SERVIZIO (integrazione B2B), in
 * contrapposizione al contesto utente (AuthContext). Rappresenta un
 * IntegrationClient: ha un tenant e un insieme di scopi, ma NESSUN userId/role.
 */
export interface ServiceContext {
  tenantId: string;
  /** clientId pubblico dell'IntegrationClient (per audit/log). */
  clientId: string;
  scopes: IntegrationScope[];
  correlationId: string;
}

/** Chiave con cui la ServiceAuthGuard allega il contesto alla request. */
export const SERVICE_CONTEXT_KEY = 'serviceContext';

/**
 * Decorator per iniettare il ServiceContext negli endpoint di integrazione:
 *   method(@CurrentService() svc: ServiceContext) { ... }
 */
export const CurrentService = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ServiceContext => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ [SERVICE_CONTEXT_KEY]?: ServiceContext }>();
    const svc = request[SERVICE_CONTEXT_KEY];
    if (!svc) {
      throw new Error('ServiceContext assente: la rotta richiede ServiceAuthGuard');
    }
    return svc;
  },
);
