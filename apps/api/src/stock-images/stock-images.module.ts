import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StockImageProvider } from '@scorm/domain';
import { PexelsStockImageProvider, UnsplashStockImageProvider } from '@scorm/adapters/stock';
import type { AppConfig } from '../config/configuration.js';
import { STOCK_IMAGE_PROVIDER } from '../providers/provider.constants.js';
import { StockImagesController } from './stock-images.controller.js';
import { StockImagesService } from './stock-images.service.js';

/**
 * Provider dell'adapter stock scelto da configurazione. `null` se il provider
 * selezionato non ha la relativa API key (dev/test): il service risponde 501.
 */
const stockProvider = {
  provide: STOCK_IMAGE_PROVIDER,
  inject: [ConfigService],
  useFactory: (config: ConfigService<AppConfig, true>): StockImageProvider | null => {
    const cfg = config.get('stock', { infer: true });
    if (cfg.provider === 'pexels' && cfg.pexelsApiKey) {
      return new PexelsStockImageProvider({ apiKey: cfg.pexelsApiKey });
    }
    if (cfg.provider === 'unsplash' && cfg.unsplashAccessKey) {
      return new UnsplashStockImageProvider({ accessKey: cfg.unsplashAccessKey });
    }
    return null;
  },
};

@Module({
  controllers: [StockImagesController],
  providers: [StockImagesService, stockProvider],
  exports: [StockImagesService],
})
export class StockImagesModule {}
