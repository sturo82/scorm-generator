import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { Equals, IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { UserRole } from '@prisma/client';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { DataDeletionService } from './data-deletion.service.js';
import { AdminUsersService } from './admin-users.service.js';

/** Richiede conferma esplicita per evitare cancellazioni accidentali. */
class DeleteDataDto {
  @Equals(true)
  confirm!: true;
}

/** Invito di un nuovo utente nel tenant corrente. */
class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsIn(['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'])
  role!: UserRole;
}

/**
 * Operazioni amministrative sensibili. La cancellazione dei dati del tenant è
 * riservata al ruolo OWNER (Requisito 12.5). La gestione utenti (inviti) è
 * riservata ad ADMIN e superiori.
 */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly deletion: DataDeletionService,
    private readonly users: AdminUsersService,
  ) {}

  @Delete('tenant-data')
  @Roles('OWNER')
  deleteTenantData(@CurrentContext() ctx: AuthContext, @Body() _dto: DeleteDataDto) {
    return this.deletion.deleteTenantContent(ctx);
  }

  @Get('users')
  @Roles('ADMIN')
  listUsers(@CurrentContext() ctx: AuthContext) {
    return this.users.listUsers(ctx);
  }

  @Post('users')
  @Roles('ADMIN')
  createUser(@CurrentContext() ctx: AuthContext, @Body() dto: CreateUserDto) {
    return this.users.createUser(ctx, { email: dto.email, displayName: dto.displayName, role: dto.role });
  }
}
