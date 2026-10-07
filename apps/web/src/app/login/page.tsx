'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
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
          <div className="mb-2 grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="size-6" />
          </div>
          <CardTitle className="text-xl">Accedi a SCORM Generator</CardTitle>
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
