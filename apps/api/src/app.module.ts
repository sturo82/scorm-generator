import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { loadConfiguration } from './config/configuration.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProvidersModule } from './providers/providers.module.js';
import { AuthModule } from './auth/auth.module.js';
import { TenancyModule } from './tenancy/tenancy.module.js';
import { PlansModule } from './plans/plans.module.js';
import { KnowledgeModule } from './knowledge/knowledge.module.js';
import { CoursesModule } from './courses/courses.module.js';
import { BrandsModule } from './brands/brands.module.js';
import { GenerationModule } from './generation/generation.module.js';
import { MeteringModule } from './metering/metering.module.js';
import { EditorialModule } from './editorial/editorial.module.js';
import { ExportModule } from './export/export.module.js';
import { ObservabilityModule } from './observability/observability.module.js';
import { AdminModule } from './admin/admin.module.js';
import { BrandingModule } from './branding/branding.module.js';
import { VideosModule } from './videos/videos.module.js';
import { StockImagesModule } from './stock-images/stock-images.module.js';
import { IntegrationModule } from './integration/integration.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadConfiguration],
    }),
    // Rate limiting globale (Requisito 12): 100 richieste / 60s per client.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    ProvidersModule,
    AuthModule,
    TenancyModule,
    PlansModule,
    KnowledgeModule,
    CoursesModule,
    BrandsModule,
    MeteringModule,
    GenerationModule,
    EditorialModule,
    ExportModule,
    ObservabilityModule,
    AdminModule,
    BrandingModule,
    VideosModule,
    StockImagesModule,
    IntegrationModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
