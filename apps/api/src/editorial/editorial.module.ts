import { Module } from '@nestjs/common';
import { GenerationModule } from '../generation/generation.module.js';
import { EditorialService } from './editorial.service.js';
import { EditorialController } from './editorial.controller.js';

/**
 * Modulo editor human-in-the-loop. Importa GenerationModule per la
 * rigenerazione mirata dei contenuti.
 */
@Module({
  imports: [GenerationModule],
  controllers: [EditorialController],
  providers: [EditorialService],
  exports: [EditorialService],
})
export class EditorialModule {}
