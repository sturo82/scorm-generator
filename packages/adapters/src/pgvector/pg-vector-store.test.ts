import { describe, it, expect } from 'vitest';
import { toVectorLiteral, stripSslmode, PgVectorStore } from './pg-vector-store.js';

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

describe('stripSslmode', () => {
  it('rimuove sslmode=require e attiva ssl rilassato', () => {
    const r = stripSslmode('postgresql://u:p@host:5432/db?schema=public&sslmode=require');
    expect(r.connectionString).toBe('postgresql://u:p@host:5432/db?schema=public');
    expect(r.relaxSsl).toBe(true);
  });
  it('gestisce sslmode come unico parametro', () => {
    const r = stripSslmode('postgresql://u:p@host/db?sslmode=require');
    expect(r.connectionString).toBe('postgresql://u:p@host/db');
    expect(r.relaxSsl).toBe(true);
  });
  it('non attiva ssl rilassato con verify-full', () => {
    const r = stripSslmode('postgresql://u:p@host/db?sslmode=verify-full');
    expect(r.relaxSsl).toBe(false);
  });
  it('nessun sslmode: invariato, no ssl', () => {
    const r = stripSslmode('postgresql://u:p@host/db?schema=public');
    expect(r.connectionString).toBe('postgresql://u:p@host/db?schema=public');
    expect(r.relaxSsl).toBe(false);
  });
});
