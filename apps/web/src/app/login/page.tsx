'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
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
  const oidc = isOidcEnabled();

  async function handleLogin() {
    setLoading(true);
    setError(null);
    if (oidc) {
      try {
        await beginLogin();
        // beginLogin reindirizza all'IdP; non torna qui in caso di successo.
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Errore di autenticazione');
        setLoading(false);
      }
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
          <Button data-testid="login-button" size="lg" onClick={handleLogin} disabled={loading}>
            {loading ? 'Accesso…' : oidc ? 'Accedi con SSO' : 'Entra come Dev Owner'}
          </Button>
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
        </CardContent>
      </Card>
    </main>
  );
}
