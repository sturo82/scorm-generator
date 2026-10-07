import { Module } from '@nestjs/common';
import { VideosService } from './videos.service.js';
import { VideosController } from './videos.controller.js';

@Module({
  controllers: [VideosController],
  providers: [VideosService],
  exports: [VideosService],
})
export class VideosModule {}
