import { parsePollySpeechMarks, splitTextForTts } from './polly-speech-provider.js';
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

describe('splitTextForTts', () => {
  it('testo corto → un solo chunk', () => {
    expect(splitTextForTts('Ciao mondo.', 2800)).toEqual(['Ciao mondo.']);
  });

  it('testo vuoto → nessun chunk', () => {
    expect(splitTextForTts('   ', 2800)).toEqual([]);
  });

  it('spezza ai confini di frase sotto il limite', () => {
    const s1 = 'A'.repeat(30) + '.';
    const s2 = 'B'.repeat(30) + '.';
    const s3 = 'C'.repeat(30) + '.';
    const chunks = splitTextForTts(`${s1} ${s2} ${s3}`, 40);
    // Ogni frase ~31 char: con limite 40 non ne stanno due per chunk.
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length <= 40)).toBe(true);
    // Il testo ricomposto contiene tutte le frasi, in ordine.
    expect(chunks.join(' ')).toContain(s1);
    expect(chunks.join(' ')).toContain(s3);
  });

  it('una frase più lunga del limite viene spezzata per parole', () => {
    const longSentence = Array.from({ length: 20 }, (_, i) => `parola${i}`).join(' ') + '.';
    const chunks = splitTextForTts(longSentence, 30);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 30)).toBe(true);
  });

  it('nessun chunk supera il limite e tutte le parole sono preservate', () => {
    const text = Array.from({ length: 200 }, (_, i) => `frase numero ${i}.`).join(' ');
    const chunks = splitTextForTts(text, 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    // Conteggio parole preservato (nessuna parola persa nel taglio).
    const wordsIn = text.split(/\s+/).filter(Boolean).length;
    const wordsOut = chunks.join(' ').split(/\s+/).filter(Boolean).length;
    expect(wordsOut).toBe(wordsIn);
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
