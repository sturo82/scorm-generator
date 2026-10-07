import { Global, Module } from '@nestjs/common';
import { QuotaService } from './quota.service.js';

import { UsageController } from './usage.controller.js';

@Global()
@Module({
  controllers: [UsageController],
  providers: [QuotaService],
  exports: [QuotaService],
})
export class PlansModule {}
