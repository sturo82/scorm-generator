'use client';

/**
 * Autenticazione mock per sviluppo (Requisito: login mock concordato). Mantiene
 * una "sessione" dev lato client: un utente/tenant fittizio e un token che
 * l'API client allega come Bearer. In produzione va sostituita da un vero flusso
 * OIDC; l'interfaccia resta la stessa.
 */

export interface DevSession {
  token: string;
  user: { id: string; email: string; displayName: string; role: string };
  tenant: { id: string; name: string };
}

const STORAGE_KEY = 'scorm.dev.session';

const DEFAULT_SESSION: DevSession = {
  // Token dev non firmato: usato solo con l'API in modalità dev/mock.
  token: 'dev-token',
  user: { id: 'u-dev', email: 'owner@acme.test', displayName: 'Dev Owner', role: 'OWNER' },
  tenant: { id: 'tenant-dev', name: 'Acme' },
};

export function getSession(): DevSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DevSession;
  } catch {
    return null;
  }
}

export function login(session: DevSession = DEFAULT_SESSION): DevSession {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function logout(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

/**
 * Costruisce e salva una sessione a partire dai token OIDC reali. L'access token
 * dell'IdP diventa il Bearer verso l'API (che lo valida via JWKS). I claim
 * servono solo a popolare la UI; l'autorizzazione resta server-side.
 */
export function loginWithOidc(args: {
  accessToken: string;
  claims: Record<string, unknown>;
}): DevSession {
  const { accessToken, claims } = args;
  const str = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback);
  const session: DevSession = {
    token: accessToken,
    user: {
      id: str(claims.sub, 'u-oidc'),
      email: str(claims.email, ''),
      displayName: str(claims.name, str(claims.email, 'Utente')),
      role: str(claims.role, 'OWNER'),
    },
    tenant: {
      id: str(claims.tenant_id, 'tenant'),
      name: str(claims.tenant_name, 'Tenant'),
    },
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  return session;
}

/**
 * Costruisce e salva una sessione a partire dall'esito del redeem SSO
 * (Scenario 2). Il token utente emesso dalla nostra API diventa il Bearer; i
 * dati utente/tenant popolano la UI. L'autorizzazione resta server-side.
 */
export function loginWithSso(args: {
  accessToken: string;
  user: { id: string; email: string; displayName: string | null; role: string };
  tenant: { id: string; name?: string };
}): DevSession {
  const session: DevSession = {
    token: args.accessToken,
    user: {
      id: args.user.id,
      email: args.user.email,
      displayName: args.user.displayName || args.user.email,
      role: args.user.role,
    },
    tenant: { id: args.tenant.id, name: args.tenant.name || 'Workspace' },
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  return session;
}

export { DEFAULT_SESSION };
