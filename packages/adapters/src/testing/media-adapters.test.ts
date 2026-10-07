import { describe, it, expect } from 'vitest';
import { MockImageProvider, MockSpeechProvider } from './index.js';

describe('MockImageProvider', () => {
  it('restituisce un PNG valido con header corretto', async () => {
    const p = new MockImageProvider();
    const r = await p.generate({ prompt: 'qualsiasi' });
    expect(r.contentType).toBe('image/png');
    expect(r.model).toBe('mock');
    // Firma PNG: 0x89 'P' 'N' 'G'.
    expect(r.bytes[0]).toBe(0x89);
    expect(r.bytes[1]).toBe(0x50);
    expect(r.bytes[2]).toBe(0x4e);
    expect(r.bytes[3]).toBe(0x47);
  });
});

describe('MockSpeechProvider', () => {
  it('restituisce un audio mpeg non vuoto', async () => {
    const p = new MockSpeechProvider();
    const r = await p.synthesize({ text: 'ciao', language: 'it-IT' });
    expect(r.contentType).toBe('audio/mpeg');
    expect(r.bytes.byteLength).toBeGreaterThan(0);
  });

  it('propaga la voce richiesta', async () => {
    const p = new MockSpeechProvider();
    const r = await p.synthesize({ text: 'x', voice: 'Giorgio' });
    expect(r.voice).toBe('Giorgio');
  });
});
