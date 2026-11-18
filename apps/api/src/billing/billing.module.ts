import { Global, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { PayerMiddleware } from './payer-context.js';

/** Addebito in crediti delle generazioni sopra il wallet di Manager. Globale: serve a più moduli. */
@Global()
@Module({
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(PayerMiddleware).forRoutes('*');
  }
}
