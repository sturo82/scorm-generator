import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@prisma/client';

/**
 * Dichiara i ruoli autorizzati per una rotta (Requisito 1.3). Esempio:
 *   @Roles('OWNER', 'ADMIN')
 * Senza @Roles la rotta richiede solo autenticazione (qualsiasi ruolo).
 */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
