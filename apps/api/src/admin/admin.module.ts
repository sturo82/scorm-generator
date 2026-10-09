import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { AppConfig } from '../config/configuration.js';
import { COGNITO_CLIENT } from '../providers/provider.constants.js';
import { DataDeletionService } from './data-deletion.service.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminController } from './admin.controller.js';

/**
 * Provider del client Cognito: costruito solo se COGNITO_USER_POOL_ID è
 * configurato (produzione). In dev/test è `null` e il service inviti risponde
 * 501. Le credenziali vengono dalla default credential chain (task role IAM).
 */
const cognitoProvider = {
  provide: COGNITO_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService<AppConfig, true>): CognitoIdentityProviderClient | null => {
    const cfg = config.get('cognito', { infer: true });
    if (!cfg.userPoolId) return null;
    return new CognitoIdentityProviderClient({ region: cfg.region });
  },
};

@Module({
  controllers: [AdminController],
  providers: [DataDeletionService, AdminUsersService, cognitoProvider],
  exports: [DataDeletionService, AdminUsersService],
})
export class AdminModule {}
