'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api/client';
import { loginWithSso } from '@/lib/auth';

/**
 * Landing SSO (Scenario 2). Una piattaforma terza (es. OnDemand) ha emesso un
 * ticket monouso per l'utente e lo reindirizza qui con ?ticket=... La pagina
 * scambia il ticket con una sessione utente e porta alla dashboard.
 */
export default function SsoPage() {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function run() {
      const ticket = new URLSearchParams(window.location.search).get('ticket');
      if (!ticket) {
        setError('Ticket SSO assente nell’URL.');
        return;
      }
      try {
        const res = await getApiClient().redeemSso(ticket);
        loginWithSso({
          accessToken: res.access_token,
          user: res.user,
          tenant: res.tenant,
        });
        if (!cancelled) router.replace('/dashboard');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Accesso SSO non riuscito');
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
            {error ? 'Accesso non riuscito' : 'Accesso in corso…'}
          </CardTitle>
          <CardDescription>
            {error ?? 'Stiamo completando l’accesso dalla tua piattaforma.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {error ? (
            <Button onClick={() => router.replace('/login')}>Vai al login</Button>
          ) : (
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
