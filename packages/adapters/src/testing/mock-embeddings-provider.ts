import type { EmbeddingsProvider } from '@scorm/domain';

/**
 * EmbeddingsProvider deterministico per sviluppo e test. Produce vettori
 * ripetibili dallo stesso testo tramite un hashing a bag-of-words, così che la
 * similarità rifletta grossolanamente la sovrapposizione lessicale. NON per
 * produzione.
 */
export class MockEmbeddingsProvider implements EmbeddingsProvider {
  readonly id = 'mock';
  readonly dimensions: number;

  constructor(dimensions = 64) {
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.vectorize(t));
  }

  private vectorize(text: string): number[] {
    const vec = new Array<number>(this.dimensions).fill(0);
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const token of tokens) {
      const idx = hashString(token) % this.dimensions;
      vec[idx] = (vec[idx] as number) + 1;
    }
    // Normalizza per avere coseno stabile indipendente dalla lunghezza.
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return norm === 0 ? vec : vec.map((v) => v / norm);
  }
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
