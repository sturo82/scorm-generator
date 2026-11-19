'use client';
import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { OVER_BUDGET_EVENT, type OverBudgetDetail } from '@/lib/billing-events';

const fmt = (n: number) => n.toLocaleString('it-IT');

/** Conferma globale per una spesa che supera il preventivo del corso. */
export function OverBudgetDialog() {
  const [detail, setDetail] = React.useState<OverBudgetDetail | null>(null);
  React.useEffect(() => {
    const onEvent = (e: Event) => setDetail((e as CustomEvent<OverBudgetDetail>).detail);
    window.addEventListener(OVER_BUDGET_EVENT, onEvent);
    return () => window.removeEventListener(OVER_BUDGET_EVENT, onEvent);
  }, []);
  const answer = (ok: boolean) => {
    detail?.resolve(ok);
    setDetail(null);
  };
  return (
    <Dialog open={detail !== null} onClose={() => answer(false)} title="Fuori preventivo">
      {detail && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 text-sm">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700">
              <AlertTriangle className="size-5" />
            </div>
            <div className="space-y-1">
              <p>
                Questa operazione costa fino a <strong>{fmt(detail.cost)}</strong> crediti: supera il preventivo del corso di{' '}
                <strong>{fmt(detail.over)}</strong> crediti.
              </p>
              <p className="text-muted-foreground">
                Se confermi, il preventivo passa da {fmt(detail.budget)} a {fmt(detail.budget + detail.over)} crediti. Ti
                addebitiamo solo quello che viene davvero generato.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => answer(false)}>
              Annulla
            </Button>
            <Button onClick={() => answer(true)}>Conferma e procedi</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
