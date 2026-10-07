import { describe, it, expect } from 'vitest';
import { JwtAuthProvider } from './jwt-auth-provider.js';

const provider = new JwtAuthProvider({
  secret: 'test-secret',
  issuer: 'scorm-generator',
  audience: 'scorm-api',
});

describe('JwtAuthProvider', () => {
  it('verifica un token firmato e ne estrae i claim', async () => {
    const token = provider.sign({ subject: 'user-1', tenantId: 'tenant-1', email: 'a@b.c' });
    const claims = await provider.verify(token);
    expect(claims.subject).toBe('user-1');
    expect(claims.tenantId).toBe('tenant-1');
    expect(claims.email).toBe('a@b.c');
  });

  it('rifiuta un token con secret diverso', async () => {
    const other = new JwtAuthProvider({
      secret: 'wrong',
      issuer: 'scorm-generator',
      audience: 'scorm-api',
    });
    const token = other.sign({ subject: 'u', tenantId: 't' });
    await expect(provider.verify(token)).rejects.toThrow();
  });

  it('rifiuta un token con audience errata', async () => {
    const other = new JwtAuthProvider({
      secret: 'test-secret',
      issuer: 'scorm-generator',
      audience: 'altra-audience',
    });
    const token = other.sign({ subject: 'u', tenantId: 't' });
    await expect(provider.verify(token)).rejects.toThrow();
  });

  it('rifiuta un token scaduto', async () => {
    const token = provider.sign({ subject: 'u', tenantId: 't', expiresInSec: -1 });
    await expect(provider.verify(token)).rejects.toThrow();
  });

  it('rifiuta un token senza claim tenant', async () => {
    // Firma un JWT valido ma privo del claim tenant usando l'API grezza.
    const jwt = (await import('jsonwebtoken')).default;
    const token = jwt.sign({}, 'test-secret', {
      subject: 'u',
      issuer: 'scorm-generator',
      audience: 'scorm-api',
      algorithm: 'HS256',
      expiresIn: 60,
    });
    await expect(provider.verify(token)).rejects.toThrow(/tenant/);
  });
});
