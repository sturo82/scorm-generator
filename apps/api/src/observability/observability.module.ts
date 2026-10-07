import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit.service.js';
import { AuditController } from './audit.controller.js';
import { LoggingInterceptor } from './logging.interceptor.js';

/**
 * Modulo di osservabilità: audit trail + logging strutturato con correlation id
 * (Requisito 11.1 / 11.2 / 11.3). Globale così l'AuditService è iniettabile
 * ovunque e l'interceptor di logging si applica a tutte le rotte.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor }],
  exports: [AuditService],
})
export class ObservabilityModule {}
