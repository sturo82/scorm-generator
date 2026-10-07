import { describe, it, expect, vi } from 'vitest';
import { Container, createToken } from './container.js';

describe('Container DI', () => {
  it('risolve un valore registrato', () => {
    const token = createToken<number>('num');
    const c = new Container().registerValue(token, 42);
    expect(c.resolve(token)).toBe(42);
  });

  it('risolve una factory lazy e la memorizza come singleton', () => {
    const token = createToken<{ n: number }>('obj');
    const factory = vi.fn(() => ({ n: 1 }));
    const c = new Container().registerFactory(token, factory);

    expect(factory).not.toHaveBeenCalled();
    const a = c.resolve(token);
    const b = c.resolve(token);

    expect(a).toBe(b); // stessa istanza
    expect(factory).toHaveBeenCalledTimes(1); // creata una sola volta
  });

  it('permette alle factory di risolvere altre dipendenze', () => {
    const dep = createToken<number>('dep');
    const svc = createToken<number>('svc');
    const c = new Container()
      .registerValue(dep, 10)
      .registerFactory(svc, (container) => container.resolve(dep) * 2);

    expect(c.resolve(svc)).toBe(20);
  });

  it('has() riflette le registrazioni', () => {
    const token = createToken<string>('s');
    const c = new Container();
    expect(c.has(token)).toBe(false);
    c.registerValue(token, 'x');
    expect(c.has(token)).toBe(true);
  });

  it('lancia se il token non è registrato', () => {
    const token = createToken<string>('missing');
    const c = new Container();
    expect(() => c.resolve(token)).toThrow(/Nessuna registrazione/);
  });
});
