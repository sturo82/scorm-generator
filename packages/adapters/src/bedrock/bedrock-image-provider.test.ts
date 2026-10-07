import { describe, it, expect } from 'vitest';
import { aspectRatio } from './bedrock-image-provider.js';

/** Set di aspect ratio accettati da Stable Image (per non inviare valori fuori enum). */
const VALID = new Set(['21:9', '16:9', '3:2', '5:4', '1:1', '4:5', '2:3', '9:16', '9:21']);

describe('aspectRatio', () => {
  it('restituisce sempre un valore nel set supportato da Stable Image', () => {
    const cases: Array<[number, number]> = [
      [1024, 768], // 4:3 non valido -> deve mappare al più vicino (5:4)
      [1920, 1080],
      [1000, 1000],
      [768, 1024],
      [2000, 500],
    ];
    for (const [w, h] of cases) {
      expect(VALID.has(aspectRatio(w, h))).toBe(true);
    }
  });

  it('mappa 1024x768 (4:3) a 5:4, il più vicino valido', () => {
    expect(aspectRatio(1024, 768)).toBe('5:4');
  });

  it('riconosce il quadrato come 1:1', () => {
    expect(aspectRatio(512, 512)).toBe('1:1');
  });

  it('riconosce 16:9 esatto', () => {
    expect(aspectRatio(1920, 1080)).toBe('16:9');
  });
});
