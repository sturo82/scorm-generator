import { SetMetadata } from '@nestjs/common';
import type { IntegrationScope } from './integration-scopes.js';

/**
 * Dichiara gli scopi richiesti da un endpoint di integrazione. Il token di
 * servizio deve possederli TUTTI. Esempio:
 *   @RequiredScopes('catalog:read')
 */
export const REQUIRED_SCOPES_KEY = 'requiredScopes';
export const RequiredScopes = (
  ...scopes: IntegrationScope[]
): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_SCOPES_KEY, scopes);
