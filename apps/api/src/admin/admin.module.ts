import { Module } from '@nestjs/common';
import { DataDeletionService } from './data-deletion.service.js';
import { AdminController } from './admin.controller.js';

@Module({
  controllers: [AdminController],
  providers: [DataDeletionService],
  exports: [DataDeletionService],
})
export class AdminModule {}
