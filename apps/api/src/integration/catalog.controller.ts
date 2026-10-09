import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CatalogService } from './catalog.service.js';
import { ServiceAuthGuard } from './service-auth.guard.js';
import { CurrentService, type ServiceContext } from './service-context.js';
import { RequiredScopes } from './required-scopes.decorator.js';
import { INTEGRATION_SCOPES } from './integration-scopes.js';
import { DownloadQuerySchema, type DownloadQuery } from './dto.js';

/**
 * API di catalogo per le integrazioni B2B (macchina-a-macchina). Protetta dalla
 * ServiceAuthGuard (token di servizio), NON dall'auth utente: per questo è
 * marcata @Public (salta l'AuthGuard globale) e usa la propria guard.
 *
 * Espone solo i corsi condivisibili e approvati del tenant del token.
 */
@Public()
@UseGuards(ServiceAuthGuard)
@Controller('integration/catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /** Elenco dei corsi condivisibili del tenant. */
  @Get('courses')
  @RequiredScopes(INTEGRATION_SCOPES.CATALOG_READ)
  listCourses(@CurrentService() svc: ServiceContext) {
    return this.catalog.listCourses(svc.tenantId);
  }

  /** Dettaglio di un corso condivisibile. */
  @Get('courses/:id')
  @RequiredScopes(INTEGRATION_SCOPES.CATALOG_READ)
  getCourse(@CurrentService() svc: ServiceContext, @Param('id') id: string) {
    return this.catalog.getCourse(svc.tenantId, id);
  }

  /** Versioni di pacchetto SCORM pronte per il corso. */
  @Get('courses/:id/packages')
  @RequiredScopes(INTEGRATION_SCOPES.CATALOG_READ)
  listPackages(@CurrentService() svc: ServiceContext, @Param('id') id: string) {
    return this.catalog.listPackages(svc.tenantId, id);
  }

  /**
   * URL di download firmato del pacchetto SCORM. Se non esiste un pacchetto
   * pronto, viene costruito al volo. Richiede lo scope package:download.
   */
  @Get('courses/:id/download')
  @RequiredScopes(INTEGRATION_SCOPES.CATALOG_READ, INTEGRATION_SCOPES.PACKAGE_DOWNLOAD)
  download(
    @CurrentService() svc: ServiceContext,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(DownloadQuerySchema)) query: DownloadQuery,
  ) {
    return this.catalog.download(svc.tenantId, id, {
      profile: query.profile,
      brandId: query.brandId,
    });
  }
}
