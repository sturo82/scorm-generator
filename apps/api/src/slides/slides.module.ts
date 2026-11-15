import { Module } from '@nestjs/common';
import { CoursesModule } from '../courses/courses.module.js';
import { GenerationModule } from '../generation/generation.module.js';
import { SlidesController } from './slides.controller.js';
import { SlidesService } from './slides.service.js';
import { SlideScriptsService } from './slide-scripts.service.js';
import { SlideClipsService } from './slide-clips.service.js';
import { SlideLessonService } from './slide-lesson.service.js';

/** Importazione slide (PDF → PNG + testo) per i video-lezione con avatar. */
@Module({
  imports: [CoursesModule, GenerationModule],
  controllers: [SlidesController],
  providers: [SlidesService, SlideScriptsService, SlideClipsService, SlideLessonService],
  exports: [SlidesService, SlideScriptsService, SlideClipsService, SlideLessonService],
})
export class SlidesModule {}
