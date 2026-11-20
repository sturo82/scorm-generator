'use client';
import * as React from 'react';
import Link from 'next/link';
import { Coins } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useWallet } from '@/lib/api/hooks';

const fmt = (n: number) => n.toLocaleString('it-IT');

/** True se l'utente ha chiesto al sistema di ridurre le animazioni. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}

/**
 * Importo animato: quando il saldo cambia il numero scorre fino al nuovo valore, compare la
 * variazione ("−162" o "+1.000") che sale e svanisce, la moneta gira e il badge ha un breve alone.
 * Con "riduci animazioni" il valore cambia e basta.
 */
function useAnimatedAmount(target: number | undefined, reduced: boolean) {
  const [shown, setShown] = React.useState(target);
  const [delta, setDelta] = React.useState<{ value: number; key: number } | null>(null);
  const prev = React.useRef(target);
  React.useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (target === undefined || from === undefined || from === target) {
      setShown(target);
      return;
    }
    if (reduced) {
      setShown(target);
      return;
    }
    const key = Date.now();
    setDelta({ value: target - from, key });
    const clear = setTimeout(() => setDelta((d) => (d?.key === key ? null : d)), 1800);
    const start = performance.now();
    const duration = 900;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(clear);
    };
  }, [target, reduced]);
  return { shown, delta };
}

/** Saldo del wallet a crediti nell'intestazione, con link di ricarica per l'owner. Nascosto se l'azienda non è addebitata. */
export function WalletBadge() {
  const { data } = useWallet();
  const reduced = useReducedMotion();
  const amount = data?.enabled ? (data.available ?? data.balance) : undefined;
  const { shown, delta } = useAnimatedAmount(amount, reduced);
  if (!data?.enabled) return null;
  const down = (delta?.value ?? 0) < 0;
  return (
    <div
      key={delta?.key ?? 'wallet'}
      style={{ ['--wallet-glow' as string]: down ? '38 92% 60%' : '152 70% 50%' }}
      className={cn(
        'relative flex items-center gap-2 rounded-full border border-white/15 bg-white/10 py-1 pl-3 pr-1 text-sm text-white',
        delta && 'animate-wallet-glow',
      )}
    >
      <Link
        href="/wallet"
        className="flex items-center gap-2 hover:text-white/80"
        title={`Paga: ${data.payer === 'PERSONAL' ? 'wallet personale' : 'wallet azienda'}. Gestisci wallet`}
      >
        <span className="[perspective:200px]">
          <Coins className={cn('size-4 text-white/70', delta && 'animate-coin-flip text-amber-300')} aria-hidden />
        </span>
        <span className="hidden text-xs text-white/60 sm:inline">{data.payer === 'PERSONAL' ? 'Personale' : 'Azienda'}</span>
        <span className="tabular-nums">
          {data.payer === 'COMPANY' && data.companyAccess === 'missing' ? (
            'Wallet non attivo'
          ) : shown !== undefined ? (
            <>
              <strong>{fmt(shown)}</strong> crediti
            </>
          ) : (
            'Crediti'
          )}
        </span>
      </Link>
      {delta && (
        <span
          key={delta.key}
          aria-live="polite"
          className={cn(
            'pointer-events-none absolute left-1/2 top-full mt-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold shadow-float animate-credit-float',
            down ? 'bg-amber-400 text-amber-950' : 'bg-emerald-400 text-emerald-950',
          )}
        >
          {down ? '−' : '+'}
          {fmt(Math.abs(delta.value))} crediti
        </span>
      )}
      {data.canTopup && (
        <Link
          href={data.payer === 'PERSONAL' || !data.topupUrl ? '/wallet' : data.topupUrl}
          target={data.payer === 'PERSONAL' || !data.topupUrl ? undefined : '_blank'}
          rel="noreferrer"
          className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90"
        >
          Ricarica
        </Link>
      )}
    </div>
  );
}
