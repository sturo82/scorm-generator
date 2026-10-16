import { describe, it, expect } from 'vitest';
import { assertSafeUrl, BlockedUrlError } from './ssrf-guard.js';

/** Resolver DNS finto: mappa host → IP controllati nei test. */
function fakeResolver(map: Record<string, string[]>) {
  return async (host: string): Promise<string[]> => {
    const ips = map[host];
    if (!ips) throw new Error('NXDOMAIN');
    return ips;
  };
}

describe('assertSafeUrl (anti-SSRF)', () => {
  it('accetta un URL pubblico http/https', async () => {
    const r = fakeResolver({ 'example.com': ['93.184.216.34'] });
    await expect(assertSafeUrl('https://example.com/feed.xml', r)).resolves.toBeInstanceOf(URL);
    await expect(assertSafeUrl('http://example.com/feed', r)).resolves.toBeInstanceOf(URL);
  });

  it('rifiuta schemi non http/https', async () => {
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toThrow(BlockedUrlError);
    await expect(assertSafeUrl('ftp://example.com')).rejects.toThrow(BlockedUrlError);
    await expect(assertSafeUrl('gopher://example.com')).rejects.toThrow(BlockedUrlError);
  });

  it('rifiuta localhost e host interni per nome', async () => {
    await expect(assertSafeUrl('http://localhost/')).rejects.toThrow(BlockedUrlError);
    await expect(assertSafeUrl('http://api.internal/')).rejects.toThrow(BlockedUrlError);
  });

  it('rifiuta IP privati/loopback/link-local diretti', async () => {
    await expect(assertSafeUrl('http://127.0.0.1/')).rejects.toThrow(BlockedUrlError);
    await expect(assertSafeUrl('http://10.0.0.5/')).rejects.toThrow(BlockedUrlError);
    await expect(assertSafeUrl('http://192.168.1.1/')).rejects.toThrow(BlockedUrlError);
    await expect(assertSafeUrl('http://172.16.0.1/')).rejects.toThrow(BlockedUrlError);
    await expect(assertSafeUrl('http://[::1]/')).rejects.toThrow(BlockedUrlError);
  });

  it('blocca l’endpoint di metadata cloud (169.254.169.254)', async () => {
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(BlockedUrlError);
  });

  it('blocca un host che RISOLVE a un IP privato (DNS rebinding naive)', async () => {
    const r = fakeResolver({ 'evil.example': ['10.1.2.3'] });
    await expect(assertSafeUrl('https://evil.example/feed', r)).rejects.toThrow(BlockedUrlError);
  });

  it('blocca se anche UNO degli IP risolti è privato', async () => {
    const r = fakeResolver({ 'mixed.example': ['93.184.216.34', '127.0.0.1'] });
    await expect(assertSafeUrl('https://mixed.example/feed', r)).rejects.toThrow(BlockedUrlError);
  });

  it('rifiuta host non risolvibile', async () => {
    const r = fakeResolver({});
    await expect(assertSafeUrl('https://nope.example/feed', r)).rejects.toThrow(BlockedUrlError);
  });
});
