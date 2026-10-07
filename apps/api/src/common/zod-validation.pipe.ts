import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Pipe di validazione basato su uno schema Zod. Convalida (e normalizza con i
 * default) il valore in ingresso usando gli schema di @scorm/contracts, che sono
 * la fonte di verità unica del dominio. In caso di errore restituisce 400 con i
 * dettagli dei campi.
 *
 * Uso: @Body(new ZodValidationPipe(SomeSchema)) dto: SomeType
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        error: 'validation_error',
        issues: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    return result.data;
  }
}
