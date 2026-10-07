import { Buffer } from 'node:buffer';
import type { ImageGenerateInput, ImageGenerateResult, ImageProvider } from '@scorm/domain';

/** PNG 1x1 trasparente valido (byte minimi), usato come immagine fittizia. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

/**
 * ImageProvider deterministico per sviluppo e test: restituisce sempre un PNG
 * 1x1 valido, senza chiamate di rete. NON per produzione.
 */
export class MockImageProvider implements ImageProvider {
  readonly id = 'mock';

  async generate(_input: ImageGenerateInput): Promise<ImageGenerateResult> {
    return {
      bytes: new Uint8Array(PNG_1x1),
      contentType: 'image/png',
      model: 'mock',
    };
  }
}
