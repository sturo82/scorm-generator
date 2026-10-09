import { describe, it, expect } from 'vitest';
import { UserTokenService } from './user-token.service.js';
import type { AppConfig } from '../config/configuration.js';

const ssoConfig: AppConfig['sso'] = {
  userJwtSecret: 'test-sso-user-secret',
  issuer: 'scorm-generator',
  audience: 'scorm-webapp',
  userTokenTtlSec: 28800,
  ticketTtlSec: 60,
  maxRole: 'ADMIN',
};

const svc = new UserTokenService({
  get: () => ssoConfig,
} as unknown as ConstructorParameters<typeof UserTokenService>[0]);

describe('UserTokenService', () => {
  it('firma e verifica un token utente', () => {
    const { accessToken } = svc.sign({
      externalId: 'sso:a@b.c',
      tenantId: 'tenant-1',
      email: 'a@b.c',
    });
    const claims = svc.verify(accessToken);
    expect(claims.sub).toBe('sso:a@b.c');
    expect(claims.tenantId).toBe('tenant-1');
    expect(claims.kind).toBe('user');
    expect(claims.email).toBe('a@b.c');
  });

  it('rifiuta un token con secret diverso', () => {
    const other = new UserTokenService({
      get: () => ({ ...ssoConfig, userJwtSecret: 'altro' }),
    } as unknown as ConstructorParameters<typeof UserTokenService>[0]);
    const { accessToken } = other.sign({ externalId: 'x', tenantId: 't' });
    expect(() => svc.verify(accessToken)).toThrow();
  });

  it('rifiuta un token di servizio (kind diverso)', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const token = jwt.sign({ tenantId: 't', kind: 'service' }, ssoConfig.userJwtSecret, {
      subject: 'x',
      issuer: ssoConfig.issuer,
      audience: ssoConfig.audience,
      algorithm: 'HS256',
      expiresIn: 60,
    });
    expect(() => svc.verify(token)).toThrow(/utente/i);
  });
});
