import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import {
  CreateFolder,
  UpdateFolder,
  type CreateFolder as CreateFolderType,
  type UpdateFolder as UpdateFolderType,
} from '@scorm/contracts';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FoldersService } from './folders.service.js';

/**
 * API delle cartelle di organizzazione dei corsi. Lettura per tutti gli utenti
 * del tenant; creazione/modifica/eliminazione richiedono EDITOR. Lo spostamento
 * di un corso vive sotto /courses/:id/folder.
 */
@Controller('folders')
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Get()
  list(@CurrentContext() ctx: AuthContext) {
    return this.folders.list(ctx.tenant.tenantId);
  }

  @Post()
  @Roles('EDITOR')
  create(
    @CurrentContext() ctx: AuthContext,
    @Body(new ZodValidationPipe(CreateFolder)) dto: CreateFolderType,
  ) {
    return this.folders.create(ctx.tenant.tenantId, dto);
  }

  @Put(':id')
  @Roles('EDITOR')
  update(
    @CurrentContext() ctx: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateFolder)) dto: UpdateFolderType,
  ) {
    return this.folders.update(ctx.tenant.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('EDITOR')
  async remove(@CurrentContext() ctx: AuthContext, @Param('id') id: string) {
    await this.folders.delete(ctx.tenant.tenantId, id);
    return { deleted: true };
  }
}
