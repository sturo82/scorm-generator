import 'reflect-metadata';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JobQueue } from '@scorm/domain';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/configuration.js';
import { JOB_QUEUE } from './providers/provider.constants.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Security headers HTTP (Requisito 12). Helmet imposta CSP, HSTS, ecc.
  app.use(helmet());

  // CORS per il frontend (origini configurabili via CORS_ORIGINS).
  const cfg = app.get(ConfigService<AppConfig, true>);
  app.enableCors({
    origin: cfg.get('corsOrigins', { infer: true }),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id'],
  });

  // Validazione input globale (Requisito 12.2).
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Avvia il consumer della coda job (worker). Per SQS fa long-polling e
  // dispatcha i job agli handler registrati dai moduli (onModuleInit). La coda
  // in-memory (sviluppo) elabora i job in background senza consumer esplicito.
  const jobs = app.get<JobQueue & { startConsumer?: () => () => void }>(JOB_QUEUE);
  if (typeof jobs.startConsumer === 'function') {
    jobs.startConsumer();
    // eslint-disable-next-line no-console
    console.log(`job queue consumer avviato (${jobs.id})`);
  }

  const port = cfg.get('port', { infer: true });
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`scorm-api in ascolto sulla porta ${port}`);
}

void bootstrap();
