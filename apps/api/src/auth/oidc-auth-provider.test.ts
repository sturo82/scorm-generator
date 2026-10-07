import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';
import { OidcAuthProvider } from './oidc-auth-provider.js';

/**
 * Verifica la logica dell'OidcAuthProvider senza un IdP reale: generiamo una
 * coppia di chiavi RSA locale, firmiamo i token come farebbe l'IdP e iniettiamo
 * un resolver di chiavi locale (createLocalJWKSet) al posto del JWKS remoto. In
 * questo modo esercitiamo il percorso reale di jose (jwtVerify: firma RS256 +
 * issuer + audience + scadenza) in modo deterministico.
 */

const ISSUER = 'https://idp.test';
const AUDIENCE = 'scorm-api';

let privateKey: KeyLike;
let publicJwk: JWK;
let keyResolver: Awaited<ReturnType<typeof buildResolver>>;

async function buildResolver(jwk: JWK) {
  const { createLocalJWKSet } = await import('jose');
  return createLocalJWKSet({ keys: [jwk] });
}

async function makeToken(claims: Record<string, unknown>, overrides: {
  issuer?: string;
  audience?: string;
  expSecondsFromNow?: number;
} = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (overrides.expSecondsFromNow ?? 300);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid })
    .setIssuedAt(now)
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setExpirationTime(exp)
    .sign(privateKey);
}

/** Firma un token SENZA claim `aud` (come l'access token di Cognito). */
async function makeTokenNoAud(claims: Record<string, unknown>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid })
    .setIssuedAt(now)
    .setIssuer(ISSUER)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

function makeProvider(tenantClaim?: string) {
  return new OidcAuthProvider({
    issuer: ISSUER,
    audience: AUDIENCE,
    jwksUri: 'https://idp.test/.well-known/jwks.json',
    tenantClaim,
    keyResolver,
  });
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  keyResolver = await buildResolver(publicJwk);
});

describe('OidcAuthProvider', () => {
  it('verifica un token valido ed estrae i claim', async () => {
    const provider = makeProvider();
    const token = await makeToken({
      sub: 'oidc-user-1',
      tenant_id: 'tenant-7',
      email: 'alice@acme.test',
    });
    const claims = await provider.verify(token);
    expect(claims.subject).toBe('oidc-user-1');
    expect(claims.tenantId).toBe('tenant-7');
    expect(claims.email).toBe('alice@acme.test');
    expect(claims.raw.sub).toBe('oidc-user-1');
  });

  it('supporta un claim tenant personalizzato', async () => {
    const provider = makeProvider('https://acme/tenant');
    const token = await makeToken({ sub: 'u', 'https://acme/tenant': 'tenant-x' });
    const claims = await provider.verify(token);
    expect(claims.tenantId).toBe('tenant-x');
  });

  it('rifiuta un token con issuer errato', async () => {
    const provider = makeProvider();
    const token = await makeToken(
      { sub: 'u', tenant_id: 't' },
      { issuer: 'https://evil.test' },
    );
    await expect(provider.verify(token)).rejects.toThrow();
  });

  it('rifiuta un token con audience errata', async () => {
    const provider = makeProvider();
    const token = await makeToken(
      { sub: 'u', tenant_id: 't' },
      { audience: 'altra-audience' },
    );
    await expect(provider.verify(token)).rejects.toThrow();
  });

  it('rifiuta un token scaduto', async () => {
    const provider = makeProvider();
    const token = await makeToken({ sub: 'u', tenant_id: 't' }, { expSecondsFromNow: -10 });
    await expect(provider.verify(token)).rejects.toThrow();
  });

  it('rifiuta un token firmato con una chiave sconosciuta', async () => {
    const provider = makeProvider();
    const other = await generateKeyPair('RS256');
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ sub: 'u', tenant_id: 't' })
      .setProtectedHeader({ alg: 'RS256', kid: 'another-key' })
      .setIssuedAt(now)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime(now + 300)
      .sign(other.privateKey);
    await expect(provider.verify(token)).rejects.toThrow();
  });

  it('rifiuta un token senza subject', async () => {
    const provider = makeProvider();
    const token = await makeToken({ tenant_id: 't' });
    await expect(provider.verify(token)).rejects.toThrow(/subject/);
  });

  it('rifiuta un token senza claim tenant', async () => {
    const provider = makeProvider();
    const token = await makeToken({ sub: 'u' });
    await expect(provider.verify(token)).rejects.toThrow(/tenant/);
  });

  // --- Compatibilità Amazon Cognito -------------------------------------------
  describe('Cognito', () => {
    it("valida un access token senza 'aud' usando 'client_id'", async () => {
      // L'access token di Cognito non ha `aud`: l'audience è in `client_id`.
      const provider = makeProvider();
      const token = await makeTokenNoAud({
        sub: 'cog-user',
        client_id: AUDIENCE,
        token_use: 'access',
        'custom:tenant_id': 'tenant-cognito',
      });
      const claims = await provider.verify(token);
      expect(claims.subject).toBe('cog-user');
      expect(claims.tenantId).toBe('tenant-cognito');
    });

    it("risolve il tenant dal custom attribute 'custom:tenant_id' di default", async () => {
      const provider = makeProvider();
      const token = await makeToken({ sub: 'u', 'custom:tenant_id': 'tenant-c' });
      const claims = await provider.verify(token);
      expect(claims.tenantId).toBe('tenant-c');
    });

    it("impone token_use quando richiesto (rifiuta un id token se atteso 'access')", async () => {
      const provider = new OidcAuthProvider({
        issuer: ISSUER,
        audience: AUDIENCE,
        jwksUri: 'https://idp.test/.well-known/jwks.json',
        expectedTokenUse: 'access',
        keyResolver,
      });
      const idToken = await makeToken({ sub: 'u', tenant_id: 't', token_use: 'id' });
      await expect(provider.verify(idToken)).rejects.toThrow(/token_use/);

      const accessToken = await makeTokenNoAud({
        sub: 'u',
        client_id: AUDIENCE,
        token_use: 'access',
        'custom:tenant_id': 't',
      });
      const claims = await provider.verify(accessToken);
      expect(claims.subject).toBe('u');
    });

    it("rifiuta un access token con client_id di un'altra app", async () => {
      const provider = makeProvider();
      const token = await makeTokenNoAud({
        sub: 'u',
        client_id: 'altro-client',
        token_use: 'access',
        'custom:tenant_id': 't',
      });
      await expect(provider.verify(token)).rejects.toThrow(/[Aa]udience/);
    });
  });
});
