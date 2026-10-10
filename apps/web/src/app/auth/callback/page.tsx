'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { completeLogin, decodeJwtPayload, isOidcEnabled } from '@/lib/oidc';
import { loginWithOidc } from '@/lib/auth';

/**
 * Redirect URI del flusso OIDC. Scambia il code con i token (PKCE), costruisce
 * la sessione dai claim e reindirizza alla dashboard. Errori mostrati con un
 * ritorno al login.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!isOidcEnabled()) {
        router.replace('/login');
        return;
      }
      try {
        const tokens = await completeLogin(window.location.search);
        // Il Bearer verso l'API è l'ID token: porta `custom:tenant_id` ed email,
        // che l'access token di Cognito non include. Fallback all'access token
        // se l'IdP non ha restituito un id_token.
        const bearerToken = tokens.idToken ?? tokens.accessToken;
        // Preferisci i claim dell'id_token per i dati profilo; fallback access.
        const claims = {
          ...decodeJwtPayload(tokens.accessToken),
          ...(tokens.idToken ? decodeJwtPayload(tokens.idToken) : {}),
        };
        loginWithOidc({ bearerToken, claims });
        if (!cancelled) router.replace('/dashboard');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Autenticazione fallita');
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <CardTitle className="text-xl">
            {error ? 'Accesso non riuscito' : 'Completamento accesso…'}
          </CardTitle>
          <CardDescription>
            {error ?? 'Stiamo verificando le credenziali con il provider.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {error ? (
            <Button data-testid="callback-retry" onClick={() => router.replace('/login')}>
              Torna al login
            </Button>
          ) : (
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
