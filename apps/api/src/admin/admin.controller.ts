import { Body, Controller, Delete } from '@nestjs/common';
import { Equals } from 'class-validator';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { DataDeletionService } from './data-deletion.service.js';

/** Richiede conferma esplicita per evitare cancellazioni accidentali. */
class DeleteDataDto {
  @Equals(true)
  confirm!: true;
}

/**
 * Operazioni amministrative sensibili. La cancellazione dei dati del tenant è
 * riservata al ruolo OWNER (Requisito 12.5) e richiede conferma esplicita.
 */
@Controller('admin')
export class AdminController {
  constructor(private readonly deletion: DataDeletionService) {}

  @Delete('tenant-data')
  @Roles('OWNER')
  deleteTenantData(@CurrentContext() ctx: AuthContext, @Body() _dto: DeleteDataDto) {
    return this.deletion.deleteTenantContent(ctx);
  }
}
