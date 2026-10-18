import { parsePollySpeechMarks } from './polly-speech-provider.js';
import { MockSpeechProvider } from '../testing/mock-speech-provider.js';

describe('parsePollySpeechMarks', () => {
  it('converte le righe NDJSON "word" in WordMark con endMs = start della parola dopo', () => {
    const ndjson = [
      '{"time":0,"type":"word","start":0,"end":4,"value":"Ciao"}',
      '{"time":500,"type":"word","start":5,"end":10,"value":"mondo"}',
      '{"time":1000,"type":"word","start":11,"end":16,"value":"prova"}',
    ].join('\n');
    const marks = parsePollySpeechMarks(ndjson);
    expect(marks).toHaveLength(3);
    expect(marks[0]).toEqual({ word: 'Ciao', startMs: 0, endMs: 500 });
    expect(marks[1]).toEqual({ word: 'mondo', startMs: 500, endMs: 1000 });
    // Ultima parola: endMs resta uguale allo start (nessuna successiva).
    expect(marks[2]).toEqual({ word: 'prova', startMs: 1000, endMs: 1000 });
  });

  it('ignora righe vuote e non-JSON, e marks non "word" (es. sentence)', () => {
    const ndjson = [
      '',
      'non-json',
      '{"time":0,"type":"sentence","value":"Ciao mondo"}',
      '{"time":100,"type":"word","value":"Ciao"}',
      '   ',
      '{"time":600,"type":"word","value":"mondo"}',
    ].join('\n');
    const marks = parsePollySpeechMarks(ndjson);
    expect(marks.map((m) => m.word)).toEqual(['Ciao', 'mondo']);
    expect(marks[0]!.startMs).toBe(100);
    expect(marks[0]!.endMs).toBe(600);
  });

  it('ritorna lista vuota su input vuoto', () => {
    expect(parsePollySpeechMarks('')).toEqual([]);
  });
});

describe('MockSpeechProvider', () => {
  it('synthesize resta MP3 fittizio (non-regressione)', async () => {
    const r = await new MockSpeechProvider().synthesize({ text: 'ciao', language: 'it' });
    expect(r.contentType).toBe('audio/mpeg');
    expect(r.bytes.byteLength).toBeGreaterThan(0);
  });

  it('synthesizeWithMarks produce un mark per parola a cadenza fissa', async () => {
    const r = await new MockSpeechProvider().synthesizeWithMarks({ text: 'uno due tre', language: 'it' });
    expect(r.marks.map((m) => m.word)).toEqual(['uno', 'due', 'tre']);
    expect(r.marks[0]!.startMs).toBe(0);
    expect(r.marks[1]!.startMs).toBe(400);
    expect(r.marks[2]!.endMs).toBe(1200);
    expect(r.contentType).toBe('audio/mpeg');
  });
});
