import { Module } from '@nestjs/common';
import { SlidesController } from './slides.controller.js';
import { SlidesService } from './slides.service.js';
import { SlideScriptsService } from './slide-scripts.service.js';
import { SlideClipsService } from './slide-clips.service.js';

/** Importazione slide (PDF → PNG + testo) per i video-lezione con avatar. */
@Module({
  controllers: [SlidesController],
  providers: [SlidesService, SlideScriptsService, SlideClipsService],
  exports: [SlidesService, SlideScriptsService, SlideClipsService],
})
export class SlidesModule {}
