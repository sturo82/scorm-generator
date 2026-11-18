import { Module } from '@nestjs/common';
import { SignupController } from './signup.controller.js';
import { SignupService } from './signup.service.js';

/** Registrazione pubblica degli account personali (senza company) tramite Manager. */
@Module({
  controllers: [SignupController],
  providers: [SignupService],
})
export class SignupModule {}
