'use client';

import * as React from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { useDeployStatus } from '@/lib/use-deploy-status';
import { APP_NAME } from '@/lib/app-brand';

/**
 * Overlay di cortesia mostrato quando l'API non è raggiungibile (tipicamente
 * durante un deploy: l'API su App Runner si riavvia per qualche minuto). In quel
 * frangente le chiamate dati fallirebbero e la UI mostrerebbe stati vuoti o
 * errori confondenti ("corso non trovato", liste vuote…). Qui mostriamo invece
 * un messaggio premium "aggiornamento in corso" su tutto il portale, che si
 * rimuove da solo appena l'API torna disponibile (polling adattivo nell'hook).
 *
 * NON blocca per il semplice avviso "nuova versione disponibile" (API comunque
 * raggiungibile): quello resta un indicatore discreto nel footer.
 */
export function UpdatingOverlay() {
  const { apiReachable } = useDeployStatus();

  // Evita il flash su micro-blip: mostra l'overlay solo se l'API resta
  // irraggiungibile per oltre ~2.5s (un singolo check fallito non basta).
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    if (apiReachable) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), 2500);
    return () => clearTimeout(t);
  }, [apiReachable]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[200] grid place-items-center overflow-hidden"
      role="status"
      aria-live="polite"
      aria-label="Aggiornamento in corso"
    >
      {/* Sfondo brandizzato con velatura premium */}
      <div
        className="absolute inset-0 backdrop-blur-md"
        style={{
          background:
            'radial-gradient(1200px 600px at 50% -10%, hsl(var(--brand-glow)/0.18), transparent 60%), hsl(var(--background)/0.85)',
        }}
        aria-hidden
      />

      <div className="relative mx-6 w-full max-w-md rounded-2xl border bg-card/90 p-8 text-center shadow-elevate">
        {/* Marchio animato */}
        <div className="mx-auto mb-5 grid size-16 place-items-center rounded-2xl bg-primary/10">
          <span className="relative grid size-16 place-items-center">
            <Loader2 className="absolute size-16 animate-spin text-primary/40 motion-reduce:animate-none" />
            <Sparkles className="size-7 text-primary" />
          </span>
        </div>

        <h2 className="text-lg font-semibold tracking-tight">Aggiornamento in corso</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Stiamo applicando un aggiornamento a {APP_NAME}. Ci vuole solo qualche istante: la pagina
          riprenderà da sola, non serve ricaricare.
        </p>

        {/* Barra di avanzamento indeterminata (decorativa) */}
        <div
          className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          aria-hidden
        >
          <div className="h-full w-1/3 animate-indeterminate rounded-full bg-gradient-to-r from-primary/40 via-primary to-primary/40" />
        </div>

        <p className="mt-4 text-[11px] uppercase tracking-widest text-muted-foreground/70">
          by Knowkube
        </p>
      </div>
    </div>
  );
}
