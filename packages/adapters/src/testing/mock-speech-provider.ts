import { Buffer } from 'node:buffer';
import type {
  SpeechProvider,
  SpeechSynthesizeInput,
  SpeechSynthesizeResult,
  SpeechSynthesizeWithMarksResult,
  SpeechWordMark,
} from '@scorm/domain';

/** Cadenza fittizia per parola (ms) nel mock dei word-timings. */
const MOCK_WORD_MS = 400;

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
      engine: input.engine ?? 'neural',
    };
  }

  /** Marks deterministici: una parola ogni MOCK_WORD_MS, per testare il sync. */
  async synthesizeWithMarks(input: SpeechSynthesizeInput): Promise<SpeechSynthesizeWithMarksResult> {
    const audio = await this.synthesize(input);
    const words = input.text.split(/\s+/).filter(Boolean);
    const marks: SpeechWordMark[] = words.map((word, i) => ({
      word,
      startMs: i * MOCK_WORD_MS,
      endMs: (i + 1) * MOCK_WORD_MS,
    }));
    return { ...audio, marks };
  }
}
