import { Global, Module } from '@nestjs/common';
import { UsageMeterService } from './usage-meter.service.js';
import { CostService } from './cost.service.js';
import { CostController } from './cost.controller.js';

/**
 * Metering costi AI e pricing. Globale perché UsageMeterService è iniettato dai
 * servizi di generazione/media per registrare il consumo dei provider a
 * pagamento. CostService/CostController espongono consuntivo e preventivo.
 */
@Global()
@Module({
  controllers: [CostController],
  providers: [UsageMeterService, CostService],
  exports: [UsageMeterService, CostService],
})
export class MeteringModule {}
