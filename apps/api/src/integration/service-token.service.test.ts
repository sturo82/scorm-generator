import { describe, it, expect } from 'vitest';
import { ServiceTokenService } from './service-token.service.js';
import type { AppConfig } from '../config/configuration.js';

const integrationConfig: AppConfig['integration'] = {
  jwtSecret: 'test-integration-secret',
  issuer: 'scorm-generator',
  audience: 'scorm-integration',
  tokenTtlSec: 3600,
};

// ConfigService finto: ritorna solo la sezione 'integration'.
const fakeConfig = {
  get: (_key: string) => integrationConfig,
} as unknown as ConstructorParameters<typeof ServiceTokenService>[0];

const svc = new ServiceTokenService(fakeConfig);

describe('ServiceTokenService', () => {
  it('firma e verifica un token di servizio con gli scopi', () => {
    const { accessToken, expiresInSec } = svc.sign({
      clientId: 'oc_abc',
      tenantId: 'tenant-1',
      scopes: ['catalog:read', 'package:download'],
    });
    expect(expiresInSec).toBe(3600);
    const claims = svc.verify(accessToken);
    expect(claims.sub).toBe('oc_abc');
    expect(claims.tenantId).toBe('tenant-1');
    expect(claims.kind).toBe('service');
    expect(claims.scopes).toEqual(['catalog:read', 'package:download']);
  });

  it('rifiuta un token firmato con secret diverso', () => {
    const other = new ServiceTokenService({
      get: () => ({ ...integrationConfig, jwtSecret: 'altro' }),
    } as unknown as ConstructorParameters<typeof ServiceTokenService>[0]);
    const { accessToken } = other.sign({ clientId: 'c', tenantId: 't', scopes: [] });
    expect(() => svc.verify(accessToken)).toThrow();
  });

  it('rifiuta un token senza claim kind=service', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const token = jwt.sign({ tenantId: 't' }, integrationConfig.jwtSecret, {
      subject: 'c',
      issuer: integrationConfig.issuer,
      audience: integrationConfig.audience,
      algorithm: 'HS256',
      expiresIn: 60,
    });
    expect(() => svc.verify(token)).toThrow(/serviz/i);
  });

  it('genera clientId e clientSecret con i prefissi attesi', () => {
    expect(svc.generateClientId()).toMatch(/^oc_/);
    expect(svc.generateClientSecret()).toMatch(/^os_/);
  });

  it('hash e verifica del secret (scrypt) in tempo costante', async () => {
    const secret = svc.generateClientSecret();
    const hash = await svc.hashSecret(secret);
    expect(hash).toMatch(/^scrypt\$/);
    expect(await svc.verifySecret(secret, hash)).toBe(true);
    expect(await svc.verifySecret('sbagliato', hash)).toBe(false);
  });

  it('verifySecret ritorna false su hash malformato', async () => {
    expect(await svc.verifySecret('x', 'non-un-hash')).toBe(false);
  });
});
