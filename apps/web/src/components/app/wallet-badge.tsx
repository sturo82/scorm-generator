'use client';
import { Coins } from 'lucide-react';
import { useWallet } from '@/lib/api/hooks';

/** Saldo del wallet a crediti nell'intestazione, con link di ricarica per l'owner. Nascosto se l'azienda non è addebitata. */
export function WalletBadge() {
  const { data } = useWallet();
  if (!data?.enabled) return null;
  const amount = data.available ?? data.balance;
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/10 py-1 pl-3 pr-1 text-sm text-white">
      <Coins className="size-4 text-white/70" aria-hidden />
      <span title={data.balance !== undefined ? `Saldo ${data.balance.toLocaleString('it-IT')} crediti` : undefined}>
        {amount !== undefined ? (
          <>
            <strong>{amount.toLocaleString('it-IT')}</strong> crediti
          </>
        ) : (
          'Crediti'
        )}
      </span>
      {data.canTopup && data.topupUrl && (
        <a
          href={data.topupUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90"
        >
          Ricarica
        </a>
      )}
    </div>
  );
}
