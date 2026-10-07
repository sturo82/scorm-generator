import { describe, it, expect } from 'vitest';
import type { ExtractedSection } from '@scorm/domain';
import { chunkSections } from './chunking.js';

describe('chunkSections', () => {
  it('mantiene testo breve in un singolo chunk per sezione', () => {
    const sections: ExtractedSection[] = [
      { heading: 'Intro', text: 'Testo breve.' },
      { heading: 'Dettagli', text: 'Altro testo breve.' },
    ];
    const chunks = chunkSections(sections);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.section).toBe('Intro');
    expect(chunks[1]?.section).toBe('Dettagli');
  });

  it('spezza testo lungo in più chunk con overlap', () => {
    const long = Array.from({ length: 50 }, (_, i) => `Frase numero ${i}.`).join(' ');
    const chunks = chunkSections([{ heading: 'Lungo', text: long }], {
      maxChars: 120,
      overlapChars: 20,
    });
    expect(chunks.length).toBeGreaterThan(1);
    // Ogni chunk rispetta approssimativamente il limite.
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(140);
      expect(c.section).toBe('Lungo');
    }
  });

  it('ignora le sezioni vuote', () => {
    const chunks = chunkSections([
      { heading: 'Vuota', text: '   ' },
      { heading: 'Piena', text: 'contenuto' },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.section).toBe('Piena');
  });
});
