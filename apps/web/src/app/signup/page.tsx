'use client';
import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Turnstile } from '@/components/app/turnstile';
import { getApiClient } from '@/lib/api/client';

const api = getApiClient();

/** Messaggio dell'API dal corpo dell'errore (`API 429: {"message":"…"}`), se leggibile. */
function apiMessage(err: unknown, fallback: string): string {
  const m = err instanceof Error ? /\{.*\}/s.exec(err.message)?.[0] : undefined;
  if (m) {
    try {
      const j = JSON.parse(m) as { message?: unknown };
      if (typeof j.message === 'string') return j.message;
    } catch {
      /* corpo non JSON */
    }
  }
  return fallback;
}

/**
 * Registrazione di un account personale (senza azienda). Manager crea l'utente e invia l'email con
 * la password temporanea. La risposta è sempre la stessa: non si rivela se l'email esiste già.
 */
export default function SignupPage() {
  const [config, setConfig] = React.useState<{ enabled: boolean; captcha: { siteKey: string } | null } | null>(null);
  const [email, setEmail] = React.useState('');
  const [website, setWebsite] = React.useState(''); // campo trappola per i bot: resta vuoto
  const [captchaToken, setCaptchaToken] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api
      .getSignupConfig()
      .then((c) => setConfig(c))
      .catch(() => setConfig({ enabled: false, captcha: null }));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.signup({ email: email.trim(), captchaToken: captchaToken || undefined, website: website || undefined });
      setSent(true);
    } catch (err) {
      setError(apiMessage(err, 'Registrazione non riuscita: riprova più tardi.'));
    } finally {
      setPending(false);
    }
  }

  const needsCaptcha = Boolean(config?.captcha) && !captchaToken;
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <CardTitle className="text-xl">Crea un account personale</CardTitle>
          <CardDescription>
            Per creare corsi e video senza un&apos;azienda. Le generazioni si pagano a crediti con il tuo wallet.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {config === null ? null : !config.enabled ? (
            <p className="text-center text-sm text-muted-foreground">La registrazione non è disponibile al momento.</p>
          ) : sent ? (
            <div className="space-y-3 text-center" role="status">
              <MailCheck className="mx-auto size-8 text-primary" aria-hidden />
              <p className="text-sm">
                Se l&apos;indirizzo è valido, ti abbiamo scritto. Controlla la posta: trovi il link e una password temporanea
                da cambiare al primo accesso.
              </p>
              <p className="text-xs text-muted-foreground">
                Non è arrivata?{' '}
                <button
                  type="button"
                  className="font-medium underline"
                  onClick={() => {
                    setSent(false);
                    setCaptchaToken('');
                  }}
                >
                  Richiedila di nuovo
                </button>
              </p>
              <Link href="/login" className="inline-block text-sm font-medium text-primary hover:underline">
                Vai all&apos;accesso
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="signup-email">Email</Label>
                <Input
                  id="signup-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nome@esempio.it"
                />
              </div>
              {/* Campo trappola: invisibile e fuori dal tab order; un bot lo compila. */}
              <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label htmlFor="signup-website">Sito web</label>
                <input
                  id="signup-website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>
              {config.captcha && <Turnstile siteKey={config.captcha.siteKey} onToken={setCaptchaToken} />}
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={pending || !email.trim() || needsCaptcha}>
                {pending ? 'Invio…' : 'Crea account'}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Hai già un account?{' '}
                <Link href="/login" className="font-medium underline">
                  Accedi
                </Link>
              </p>
            </form>
          )}
          <Link
            href="/login"
            className="mt-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Torna all&apos;accesso
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
