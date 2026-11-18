'use client';
import Link from 'next/link';
import { Coins } from 'lucide-react';
import { useWallet } from '@/lib/api/hooks';

/** Saldo del wallet a crediti nell'intestazione, con link di ricarica per l'owner. Nascosto se l'azienda non è addebitata. */
export function WalletBadge() {
  const { data } = useWallet();
  if (!data?.enabled) return null;
  const amount = data.available ?? data.balance;
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/10 py-1 pl-3 pr-1 text-sm text-white">
      <Link
        href="/wallet"
        className="flex items-center gap-2 hover:text-white/80"
        title={`Paga: ${data.payer === 'PERSONAL' ? 'wallet personale' : 'wallet azienda'}. Gestisci wallet`}
      >
        <Coins className="size-4 text-white/70" aria-hidden />
        <span className="hidden text-xs text-white/60 sm:inline">{data.payer === 'PERSONAL' ? 'Personale' : 'Azienda'}</span>
        <span>
          {amount !== undefined ? (
            <>
              <strong>{amount.toLocaleString('it-IT')}</strong> crediti
            </>
          ) : (
            'Crediti'
          )}
        </span>
      </Link>
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
