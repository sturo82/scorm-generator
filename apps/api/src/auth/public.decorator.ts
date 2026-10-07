import { SetMetadata } from '@nestjs/common';

/** Marca una rotta come pubblica (salta AuthGuard), es. health check. */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
