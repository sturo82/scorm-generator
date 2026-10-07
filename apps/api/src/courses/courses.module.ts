import { Module } from '@nestjs/common';
import { CoursesService } from './courses.service.js';
import { ModulesService } from './modules.service.js';
import { FoldersService } from './folders.service.js';
import { CoursesController } from './courses.controller.js';
import { FoldersController } from './folders.controller.js';

@Module({
  controllers: [CoursesController, FoldersController],
  providers: [CoursesService, ModulesService, FoldersService],
  exports: [CoursesService, ModulesService, FoldersService],
})
export class CoursesModule {}
