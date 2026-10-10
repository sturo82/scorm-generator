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
