'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { login } from '@/lib/auth';
import { beginLogin, isOidcEnabled } from '@/lib/oidc';

/**
 * Pagina di login. Con NEXT_PUBLIC_AUTH_MODE=oidc avvia il flusso Authorization
 * Code + PKCE verso l'IdP; altrimenti usa il login mock di sviluppo.
 */
export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Avvio automatico del flusso OIDC: true quando si arriva dall'hub d'ecosistema
  // con ?sso=1. In quel caso NON mostriamo il bottone: facciamo partire subito
  // beginLogin() (SSO silenzioso grazie alla sessione di pool già attiva).
  const [autoSso, setAutoSso] = React.useState(false);
  const oidc = isOidcEnabled();

  // "Torna indietro" dinamico: la destinazione dipende da dove si proviene.
  // Priorità: parametro ?return_to= (passato dalla piattaforma di origine) →
  // referrer esterno → home di K Scorm. Solo URL assolute http(s) sono accettate
  // per evitare open-redirect verso schemi arbitrari.
  const [backHref, setBackHref] = React.useState('/');
  const [backLabel, setBackLabel] = React.useState('Torna alla home');
  React.useEffect(() => {
    const safe = (raw: string | null): string | null => {
      if (!raw) return null;
      try {
        const u = new URL(raw, window.location.origin);
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
      } catch {
        return null;
      }
    };
    const params = new URLSearchParams(window.location.search);
    const fromParam = safe(params.get('return_to'));
    const fromRef =
      document.referrer && !document.referrer.startsWith(window.location.origin)
        ? safe(document.referrer)
        : null;
    const target = fromParam ?? fromRef;
    if (target) {
      setBackHref(target);
      try {
        setBackLabel(`Torna a ${new URL(target).hostname}`);
      } catch {
        /* mantiene l'etichetta di default */
      }
    }
  }, []);

  const startOidc = React.useCallback(
    async (loginHint?: string) => {
      setLoading(true);
      setError(null);
      try {
        await beginLogin(loginHint ? { loginHint } : undefined);
        // beginLogin reindirizza all'IdP; non torna qui in caso di successo.
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Errore di autenticazione');
        setLoading(false);
        setAutoSso(false); // mostra il bottone per riprovare manualmente
      }
    },
    [],
  );

  // Ingresso dall'hub d'ecosistema: ?sso=1 → avvia subito il flusso OIDC, senza
  // bottone intermedio. login_hint (email) è propagato se presente.
  React.useEffect(() => {
    if (!oidc) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('sso') !== '1') return;
    setAutoSso(true);
    void startOidc(params.get('login_hint') ?? undefined);
  }, [oidc, startOidc]);

  async function handleLogin() {
    if (oidc) {
      await startOidc();
      return;
    }
    login();
    router.push('/dashboard');
  }

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/kscorm-icon.png"
            alt="K Scorm"
            className="mb-2 size-14 rounded-xl object-contain"
          />
          <CardTitle className="text-xl">Accedi a K Scorm</CardTitle>
          <CardDescription>
            {oidc
              ? 'Accedi con il tuo provider aziendale (SSO).'
              : 'Ambiente di sviluppo — accesso con sessione dimostrativa.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {autoSso && !error ? (
            <p
              data-testid="login-redirecting"
              className="text-center text-sm text-muted-foreground"
              aria-live="polite"
            >
              Reindirizzamento all’accesso sicuro…
            </p>
          ) : (
            <Button data-testid="login-button" size="lg" onClick={handleLogin} disabled={loading}>
              {loading ? 'Accesso…' : oidc ? 'Accedi con SSO' : 'Entra come Dev Owner'}
            </Button>
          )}
          {error ? (
            <p data-testid="login-error" className="text-center text-xs text-destructive">
              {error}
            </p>
          ) : (
            <p className="text-center text-xs text-muted-foreground">
              {oidc
                ? 'Il token rilasciato dall’IdP viene validato dall’API via JWKS.'
                : 'L’autenticazione reale (OIDC/SSO) si collega senza modifiche al dominio.'}
            </p>
          )}
          <a
            href={backHref}
            className="mt-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            {backLabel}
          </a>
        </CardContent>
      </Card>
    </main>
  );
}
