import { Module } from '@nestjs/common';
import { SlidesController } from './slides.controller.js';
import { SlidesService } from './slides.service.js';
import { SlideScriptsService } from './slide-scripts.service.js';

/** Importazione slide (PDF → PNG + testo) per i video-lezione con avatar. */
@Module({
  controllers: [SlidesController],
  providers: [SlidesService, SlideScriptsService],
  exports: [SlidesService, SlideScriptsService],
})
export class SlidesModule {}
