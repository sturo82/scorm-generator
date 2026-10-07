import { Buffer } from 'node:buffer';
import type {
  SpeechProvider,
  SpeechSynthesizeInput,
  SpeechSynthesizeResult,
} from '@scorm/domain';

/** Frame MP3 silenzioso minimale (header valido), come audio fittizio. */
const MP3_SILENCE = Buffer.from('//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA', 'base64');

/**
 * SpeechProvider deterministico per sviluppo e test: restituisce un breve MP3
 * fittizio, senza chiamate di rete. NON per produzione.
 */
export class MockSpeechProvider implements SpeechProvider {
  readonly id = 'mock';

  async synthesize(input: SpeechSynthesizeInput): Promise<SpeechSynthesizeResult> {
    return {
      bytes: new Uint8Array(MP3_SILENCE),
      contentType: 'audio/mpeg',
      voice: input.voice ?? 'mock',
    };
  }
}
