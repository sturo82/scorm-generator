'use client';
import * as React from 'react';
import { Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { INSUFFICIENT_CREDITS_EVENT, type InsufficientCreditsDetail } from '@/lib/billing-events';
import { useWallet } from '@/lib/api/hooks';

const fmt = (n: number) => n.toLocaleString('it-IT');

/** Avviso globale «Crediti insufficienti», con il link per ricaricare (solo per l'owner dell'azienda). */
export function InsufficientCreditsDialog() {
  const [detail, setDetail] = React.useState<InsufficientCreditsDetail | null>(null);
  const wallet = useWallet();
  React.useEffect(() => {
    const onEvent = (e: Event) => setDetail((e as CustomEvent<InsufficientCreditsDetail>).detail ?? {});
    window.addEventListener(INSUFFICIENT_CREDITS_EVENT, onEvent);
    return () => window.removeEventListener(INSUFFICIENT_CREDITS_EVENT, onEvent);
  }, []);
  const w = wallet.data;
  return (
    <Dialog open={detail !== null} onClose={() => setDetail(null)} title="Crediti insufficienti">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700">
            <Coins className="size-5" />
          </div>
          <div className="space-y-1 text-sm">
            <p>Per avviare questa generazione servono più crediti di quelli disponibili.</p>
            {detail?.required !== undefined && detail.available !== undefined && (
              <p className="text-muted-foreground">
                Servono <strong className="text-foreground">{fmt(detail.required)}</strong> crediti, ne hai{' '}
                <strong className="text-foreground">{fmt(detail.available)}</strong>.
              </p>
            )}
            {w?.canTopup === false && (
              <p className="text-muted-foreground">La ricarica è riservata al titolare dell&apos;azienda.</p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDetail(null)}>
            Chiudi
          </Button>
          {w?.canTopup && w.topupUrl && (
            <a
              href={w.topupUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Ricarica
            </a>
          )}
        </div>
      </div>
    </Dialog>
  );
}
