'use client';

/**
 * Client OIDC lato browser: flusso Authorization Code + PKCE (RFC 7636), senza
 * dipendenze esterne (usa Web Crypto). Attivo quando NEXT_PUBLIC_AUTH_MODE=oidc;
 * altrimenti resta il login mock di sviluppo (vedi lib/auth.ts). I segreti del
 * client NON vivono qui: PKCE evita il client secret nel browser.
 *
 * Config via env pubbliche (build-time Next.js):
 *  - NEXT_PUBLIC_AUTH_MODE=oidc           abilita il flusso reale
 *  - NEXT_PUBLIC_OIDC_ISSUER              issuer dell'IdP (per discovery)
 *  - NEXT_PUBLIC_OIDC_CLIENT_ID           client pubblico (SPA)
 *  - NEXT_PUBLIC_OIDC_REDIRECT_URI        es. http://localhost:3100/auth/callback
 *  - NEXT_PUBLIC_OIDC_SCOPE               default "openid profile email"
 *  - NEXT_PUBLIC_OIDC_AUDIENCE            opzionale (Auth0: parametro audience)
 */

export interface OidcConfig {
  issuer: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  audience?: string;
}

const PKCE_KEY = 'scorm.oidc.pkce';
const STATE_KEY = 'scorm.oidc.state';

/** True se il flusso OIDC reale è configurato e attivo. */
export function isOidcEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AUTH_MODE === 'oidc';
}

export function getOidcConfig(): OidcConfig {
  const issuer = process.env.NEXT_PUBLIC_OIDC_ISSUER;
  const clientId = process.env.NEXT_PUBLIC_OIDC_CLIENT_ID;
  const redirectUri = process.env.NEXT_PUBLIC_OIDC_REDIRECT_URI;
  if (!issuer || !clientId || !redirectUri) {
    throw new Error(
      'OIDC abilitato ma NEXT_PUBLIC_OIDC_ISSUER / CLIENT_ID / REDIRECT_URI non configurati',
    );
  }
  return {
    issuer: issuer.replace(/\/$/, ''),
    clientId,
    redirectUri,
    scope: process.env.NEXT_PUBLIC_OIDC_SCOPE ?? 'openid profile email',
    audience: process.env.NEXT_PUBLIC_OIDC_AUDIENCE,
  };
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
}

/** Scarica i metadata OIDC (.well-known). Cache in sessionStorage per sessione. */
async function discover(issuer: string): Promise<Discovery> {
  const cacheKey = `scorm.oidc.disc.${issuer}`;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) return JSON.parse(cached) as Discovery;
  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery fallita: ${res.status}`);
  const doc = (await res.json()) as Discovery;
  sessionStorage.setItem(cacheKey, JSON.stringify(doc));
  return doc;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function sha256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Avvia il flusso: genera PKCE + state, li salva in sessionStorage e reindirizza
 * all'authorization endpoint dell'IdP.
 */
export async function beginLogin(): Promise<void> {
  const config = getOidcConfig();
  const { authorization_endpoint } = await discover(config.issuer);

  const verifier = randomString(32);
  const challenge = await sha256Challenge(verifier);
  const state = randomString(16);
  sessionStorage.setItem(PKCE_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  if (config.audience) params.set('audience', config.audience);

  window.location.assign(`${authorization_endpoint}?${params.toString()}`);
}

export interface OidcTokens {
  accessToken: string;
  idToken?: string;
  expiresIn?: number;
}

/**
 * Completa il flusso: valida lo state, scambia il code con i token via PKCE
 * (nessun client secret). Da chiamare nella pagina /auth/callback.
 */
export async function completeLogin(search: string): Promise<OidcTokens> {
  const config = getOidcConfig();
  const url = new URLSearchParams(search);
  const code = url.get('code');
  const returnedState = url.get('state');
  const error = url.get('error');
  if (error) throw new Error(`Errore dall'IdP: ${error} ${url.get('error_description') ?? ''}`);
  if (!code) throw new Error('Callback OIDC senza authorization code');

  const expectedState = sessionStorage.getItem(STATE_KEY);
  if (!expectedState || expectedState !== returnedState) {
    throw new Error('State OIDC non valido (possibile CSRF)');
  }
  const verifier = sessionStorage.getItem(PKCE_KEY);
  if (!verifier) throw new Error('Code verifier PKCE assente');

  const { token_endpoint } = await discover(config.issuer);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: verifier,
  });
  const res = await fetch(token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Scambio token fallito: ${res.status}`);
  const json = (await res.json()) as {
    access_token: string;
    id_token?: string;
    expires_in?: number;
  };

  sessionStorage.removeItem(PKCE_KEY);
  sessionStorage.removeItem(STATE_KEY);

  return {
    accessToken: json.access_token,
    idToken: json.id_token,
    expiresIn: json.expires_in,
  };
}

/** Decodifica (senza verifica di firma) il payload di un JWT per i claim UI. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (!part) return {};
  const padded = part.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return JSON.parse(decodeURIComponent(escape(atob(padded)))) as Record<string, unknown>;
  } catch {
    try {
      return JSON.parse(atob(padded)) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}
