import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public } from '../auth/public.decorator.js';

/** Versione dell'immagine API, iniettata dal CI come env del container. */
const API_VERSION = process.env.APP_VERSION || 'dev';
const API_BUILD_TIME = process.env.BUILD_TIME || '';

/**
 * Endpoint di health check: liveness, readiness (DB) e versione dell'API.
 * Escluso dal rate limiting: è interrogato in polling dal frontend (indicatore
 * di stato) e dagli health check di infrastruttura; non deve mai essere
 * throttlato.
 */
@SkipThrottle()
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  live(): { status: 'ok'; version: string; buildTime: string } {
    // Espone la versione così che il web (footer) possa rilevare quando l'API
    // è stata aggiornata o sta ripartendo durante un deploy.
    return { status: 'ok', version: API_VERSION, buildTime: API_BUILD_TIME };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok' | 'degraded'; db: boolean }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: true };
    } catch {
      return { status: 'degraded', db: false };
    }
  }
}
