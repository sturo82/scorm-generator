import { Module } from '@nestjs/common';
import { BrandingService } from './branding.service.js';
import { BrandingController } from './branding.controller.js';

@Module({
  controllers: [BrandingController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
