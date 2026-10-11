import { Global, Module } from '@nestjs/common';
import { EcosystemTokenService } from './ecosystem-token.service.js';
import { EcosystemHttpService } from './ecosystem-http.service.js';
import { EcosystemSettingsService } from './ecosystem-settings.service.js';
import { EcosystemCredentialsService } from './ecosystem-credentials.service.js';
import { EcosystemProvisioningService } from './ecosystem-provisioning.service.js';
import { EntitlementService } from './entitlement.service.js';
import { WalletService } from './wallet.service.js';
import { EcosystemConfigController } from './ecosystem-config.controller.js';

/**
 * Lato CONSUMER dell'ecosistema Knowkube: K Scorm consuma i servizi di Manager
 * (entitlement + wallet) via OAuth2 client-credentials. Globale perché il gate
 * di entitlement e il wallet servono trasversalmente (gate d'accesso e feature
 * a consumo). Tutto è gated da config: senza credenziali/flag, i servizi sono
 * no-op o fail-open (vedi EntitlementService/WalletService).
 */
@Global()
@Module({
  controllers: [EcosystemConfigController],
  providers: [
    EcosystemCredentialsService,
    EcosystemTokenService,
    EcosystemHttpService,
    EcosystemSettingsService,
    EcosystemProvisioningService,
    EntitlementService,
    WalletService,
  ],
  exports: [
    EcosystemCredentialsService,
    EcosystemTokenService,
    EcosystemHttpService,
    EcosystemSettingsService,
    EntitlementService,
    WalletService,
  ],
})
export class EcosystemModule {}
