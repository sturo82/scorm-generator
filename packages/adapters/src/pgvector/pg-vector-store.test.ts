import { describe, it, expect } from 'vitest';
import { toVectorLiteral, PgVectorStore } from './pg-vector-store.js';

describe('toVectorLiteral', () => {
  it('formatta un array come literal pgvector', () => {
    expect(toVectorLiteral([1, 2, 3])).toBe('[1,2,3]');
    expect(toVectorLiteral([0.5, -0.25])).toBe('[0.5,-0.25]');
    expect(toVectorLiteral([])).toBe('[]');
  });
});

describe('PgVectorStore', () => {
  it('richiede pool o connectionString', () => {
    expect(() => new PgVectorStore({})).toThrow(/pool o connectionString/);
  });
});
