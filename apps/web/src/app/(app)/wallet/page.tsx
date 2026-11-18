'use client';
import * as React from 'react';
import { Building2, Coins, ExternalLink, Loader2, UserRound } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { useSetWalletPayer, useStartWalletTopup, useWallet } from '@/lib/api/hooks';

const AMOUNTS_EUR = [5, 10, 20, 50];
/** Cambio di Manager: 1 EUR = 100 crediti. */
const CREDITS_PER_EUR = 100;
const BEFORE_KEY = 'wallet:personal-before';
const fmt = (n: number | undefined) => (n === undefined ? '—' : n.toLocaleString('it-IT'));

/**
 * Wallet e crediti: scelta di chi paga le generazioni (azienda o wallet personale) e ricarica del
 * wallet personale con pagamento online. Le ricariche dell'azienda si fanno nel portale del titolare.
 */
export default function WalletPage() {
  const toast = useToast();
  const wallet = useWallet();
  const setPayer = useSetWalletPayer();
  const topup = useStartWalletTopup();
  const [ret, setRet] = React.useState<'success' | 'cancel' | null>(null);
  const [waiting, setWaiting] = React.useState(false);

  // Ritorno dalla pagina di pagamento: i crediti arrivano dal webhook, anche dopo il ritorno.
  React.useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('topup');
    if (t === 'success' || t === 'cancel') setRet(t);
    if (t === 'success') setWaiting(true);
  }, []);
  const personal = wallet.data?.personal;
  React.useEffect(() => {
    if (!waiting) return;
    const before = Number(window.sessionStorage.getItem(BEFORE_KEY) ?? 'NaN');
    if (Number.isFinite(before) && personal?.balance !== undefined && personal.balance > before) {
      setWaiting(false);
      window.sessionStorage.removeItem(BEFORE_KEY);
      toast.show('Crediti accreditati', 'success');
      return;
    }
    // Si interroga il saldo finché cambia (al massimo per due minuti).
    const poll = setInterval(() => void wallet.refetch(), 3000);
    const stop = setTimeout(() => setWaiting(false), 120_000);
    return () => {
      clearInterval(poll);
      clearTimeout(stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, personal?.balance]);

  async function choose(payer: 'COMPANY' | 'PERSONAL') {
    try {
      await setPayer.mutateAsync(payer);
      toast.show(payer === 'PERSONAL' ? 'Le generazioni useranno il tuo wallet personale' : 'Le generazioni useranno il wallet aziendale', 'success');
    } catch {
      toast.show('Non sono riuscito a cambiare il wallet: riprova', 'error');
    }
  }

  async function startTopup(amountEur: number) {
    try {
      window.sessionStorage.setItem(BEFORE_KEY, String(personal?.balance ?? 0));
      const { url } = await topup.mutateAsync(amountEur);
      window.location.assign(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      toast.show(
        /invalid_amount/.test(msg)
          ? 'Importo di ricarica non valido'
          : /personal_wallet_not_allowed|403/.test(msg)
            ? 'Il wallet personale non è abilitato'
            : 'Ricarica non disponibile al momento: riprova',
        'error',
      );
    }
  }

  const w = wallet.data;
  if (wallet.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!w || !w.personalAvailable) {
    return (
      <>
        <PageHeader title="Wallet" description="Crediti per le generazioni." />
        <p className="text-sm text-muted-foreground">I crediti non sono attivi per questo account.</p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Wallet e crediti"
        description="Scegli quale wallet paga le generazioni e ricarica il tuo wallet personale."
      />
      {ret === 'success' && (
        <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm" role="status">
          {waiting ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Pagamento ricevuto: i crediti sono in elaborazione, arrivano tra pochi istanti.
            </span>
          ) : (
            'Pagamento completato. Se i crediti non compaiono entro qualche minuto, ricarica la pagina.'
          )}
        </div>
      )}
      {ret === 'cancel' && (
        <div className="mb-4 rounded-lg border bg-muted/40 p-3 text-sm" role="status">
          Ricarica annullata: non è stato addebitato nulla.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <WalletCard
          icon={<Building2 className="size-5" />}
          title="Wallet azienda"
          selected={w.payer === 'COMPANY'}
          disabled={!w.company || setPayer.isPending}
          onChoose={() => void choose('COMPANY')}
          unavailable={!w.company ? "L'azienda non paga a crediti." : undefined}
        >
          {w.company && (
            <>
              <Balance available={w.company.available} />
              {w.company.canTopup && w.company.topupUrl ? (
                <a
                  href={w.company.topupUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  Ricarica dal portale del titolare <ExternalLink className="size-3.5" />
                </a>
              ) : (
                <p className="text-xs text-muted-foreground">La ricarica è riservata al titolare dell&apos;azienda.</p>
              )}
            </>
          )}
        </WalletCard>

        <WalletCard
          icon={<UserRound className="size-5" />}
          title="Wallet personale"
          selected={w.payer === 'PERSONAL'}
          disabled={setPayer.isPending}
          onChoose={() => void choose('PERSONAL')}
        >
          {w.personal.active ? (
            <Balance available={w.personal.available} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Non è ancora attivo: si attiva quando lo scegli o fai la prima ricarica.
            </p>
          )}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Ricarica con carta</p>
            <div className="flex flex-wrap gap-2">
              {AMOUNTS_EUR.map((eur) => (
                <Button key={eur} size="sm" variant="outline" disabled={topup.isPending} onClick={() => void startTopup(eur)}>
                  {eur} € · {fmt(eur * CREDITS_PER_EUR)} crediti
                </Button>
              ))}
            </div>
            {topup.isPending && (
              <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Apro la pagina di pagamento…
              </p>
            )}
          </div>
        </WalletCard>
      </div>
    </>
  );
}

function Balance({ available }: { available: number | undefined }) {
  return (
    <p className="flex items-baseline gap-2">
      <Coins className="size-4 self-center text-muted-foreground" aria-hidden />
      <span className="text-3xl font-bold">{fmt(available)}</span>
      <span className="text-sm text-muted-foreground">crediti disponibili</span>
    </p>
  );
}

function WalletCard({
  icon,
  title,
  selected,
  disabled,
  unavailable,
  onChoose,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  selected: boolean;
  disabled: boolean;
  unavailable?: string;
  onChoose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn(selected && 'border-primary ring-1 ring-primary/40')}>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon} {title}
        </CardTitle>
        {selected ? (
          <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">Paga le generazioni</span>
        ) : (
          <Button size="sm" variant="outline" disabled={disabled} onClick={onChoose}>
            Usa questo wallet
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {unavailable && <p className="text-sm text-muted-foreground">{unavailable}</p>}
        {children}
      </CardContent>
    </Card>
  );
}
