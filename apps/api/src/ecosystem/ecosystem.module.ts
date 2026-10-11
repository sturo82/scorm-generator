import { Global, Module } from '@nestjs/common';
import { EcosystemTokenService } from './ecosystem-token.service.js';
import { EcosystemHttpService } from './ecosystem-http.service.js';
import { EcosystemRegistrationService } from './ecosystem-registration.service.js';
import { EntitlementService } from './entitlement.service.js';
import { WalletService } from './wallet.service.js';

/**
 * Lato CONSUMER dell'ecosistema Knowkube: K Scorm consuma i servizi di Manager
 * (entitlement + wallet) via OAuth2 client-credentials. Globale perché il gate
 * di entitlement e il wallet servono trasversalmente (gate d'accesso e feature
 * a consumo). Tutto è gated da config: senza credenziali/flag, i servizi sono
 * no-op o fail-open (vedi EntitlementService/WalletService).
 */
@Global()
@Module({
  providers: [
    EcosystemTokenService,
    EcosystemHttpService,
    EcosystemRegistrationService,
    EntitlementService,
    WalletService,
  ],
  exports: [EcosystemTokenService, EcosystemHttpService, EntitlementService, WalletService],
})
export class EcosystemModule {}
