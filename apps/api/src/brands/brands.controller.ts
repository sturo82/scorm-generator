import { Body, Controller, Delete, Get, Header, Param, Post, Put } from '@nestjs/common';
import { Brand } from '@scorm/contracts';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BrandsService, type BrandDefinition } from './brands.service.js';

// La definizione in input è il Brand senza id/tenantId (assegnati dal server).
const BrandDefinitionSchema = Brand.omit({ id: true, tenantId: true });

/**
 * API dei brand (Requisito 7). Creazione/modifica richiedono ruolo ADMIN
 * (gestione dell'identità visiva), lettura a chiunque sia autenticato.
 */
@Controller('brands')
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Post()
  @Roles('ADMIN')
  create(
    @CurrentContext() ctx: AuthContext,
    @Body(new ZodValidationPipe(BrandDefinitionSchema)) def: BrandDefinition,
  ) {
    return this.brands.create(ctx.tenant.tenantId, def);
  }

  @Get()
  list(@CurrentContext() ctx: AuthContext) {
    return this.brands.list(ctx.tenant.tenantId);
  }

  @Get(':id')
  get(@CurrentContext() ctx: AuthContext, @Param('id') id: string) {
    return this.brands.get(ctx.tenant.tenantId, id);
  }

  @Put(':id')
  @Roles('ADMIN')
  update(
    @CurrentContext() ctx: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(BrandDefinitionSchema)) def: BrandDefinition,
  ) {
    return this.brands.update(ctx.tenant.tenantId, id, def);
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@CurrentContext() ctx: AuthContext, @Param('id') id: string) {
    await this.brands.delete(ctx.tenant.tenantId, id);
    return { deleted: true };
  }

  /** Anteprima del tema CSS compilato dal brand. */
  @Get(':id/theme.css')
  @Header('Content-Type', 'text/css')
  async theme(@CurrentContext() ctx: AuthContext, @Param('id') id: string): Promise<string> {
    const compiled = await this.brands.compileTheme(ctx.tenant.tenantId, id);
    return compiled.css;
  }
}
