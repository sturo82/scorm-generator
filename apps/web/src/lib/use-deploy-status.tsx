'use client';

import * as React from 'react';
import { APP_NAME } from './app-brand';

/**
 * Stato di aggiornamento di web e API.
 *
 * Il frontend non ha accesso allo stato di App Runner/CI; usa segnali osservabili:
 *  - WEB: confronta la versione del bundle in esecuzione (NEXT_PUBLIC_APP_VERSION)
 *    con quella pubblicata in /version.json (servito no-cache). Se differiscono,
 *    è stata pubblicata una versione più recente → "updating" (serve ricaricare).
 *  - API: interroga /health (espone { version }). Due situazioni DISTINTE:
 *      a) API non raggiungibile / 5xx  → sta ripartendo (deploy in corso): i dati
 *         NON escono → `apiReachable = false` → mostra l'overlay di cortesia.
 *      b) API raggiungibile ma a versione diversa da quella vista all'apertura
 *         → è GIA' aggiornata e funzionante: solo un avviso "nuova versione",
 *         NON blocca il portale.
 */

export type PartStatus = 'ok' | 'updating' | 'unknown';

export interface DeployStatus {
  web: PartStatus;
  api: PartStatus;
  /** Vero se web o api stanno aggiornando (per l'indicatore del footer). */
  updating: boolean;
  /**
   * Vero se l'API risponde. Quando false, l'API sta ripartendo (deploy) e i dati
   * non escono: è il segnale per mostrare l'overlay "aggiornamento in corso".
   */
  apiReachable: boolean;
  /** Versione dell'API corrente (sha corto), se nota. */
  apiVersion: string | null;
}

const WEB_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'dev';
const POLL_OK_MS = 20_000; // cadenza normale
const POLL_DOWN_MS = 3_000; // cadenza quando l'API è giù (per accorgersi del ritorno)

/** Normalizza uno sha a 7 char (per confronto/visualizzazione coerente). */
function shortSha(v: string | null | undefined): string | null {
  if (!v) return null;
  return /^[0-9a-f]{40}$/i.test(v) ? v.slice(0, 7) : v;
}

/** Esegue il polling e calcola lo stato. Interno: usare DeployStatusProvider. */
function usePollDeployStatus(): DeployStatus {
  const [web, setWeb] = React.useState<PartStatus>('ok');
  const [api, setApi] = React.useState<PartStatus>('unknown');
  const [apiReachable, setApiReachable] = React.useState<boolean>(true);
  const [apiVersion, setApiVersion] = React.useState<string | null>(null);
  const apiBaseline = React.useRef<string | null>(null);

  React.useEffect(() => {
    // In dev (versione "dev") non ha senso: nessun deploy da monitorare.
    if (WEB_VERSION === 'dev') return;

    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? '';

    async function checkWeb() {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const doc = (await res.json()) as { version?: string };
        const published = shortSha(doc.version);
        const running = shortSha(WEB_VERSION);
        if (active) setWeb(published && running && published !== running ? 'updating' : 'ok');
      } catch {
        /* rete assente: non cambiamo lo stato (restiamo sull'ultimo noto) */
      }
    }

    async function checkApi(): Promise<boolean> {
      if (!apiBase) {
        if (active) {
          setApi('unknown');
          setApiReachable(true); // senza API base non blocchiamo nulla
        }
        return true;
      }
      try {
        const res = await fetch(`${apiBase}/health?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) {
          if (active) {
            setApi('updating');
            setApiReachable(false);
          }
          return false;
        }
        const doc = (await res.json()) as { version?: string };
        const v = shortSha(doc.version);
        if (!active) return true;
        setApiVersion(v);
        setApiReachable(true);
        if (apiBaseline.current === null) apiBaseline.current = v;
        // Versione diversa da quella iniziale → aggiornata (avviso), ma raggiungibile.
        setApi(apiBaseline.current && v && apiBaseline.current !== v ? 'updating' : 'ok');
        return true;
      } catch {
        if (active) {
          setApi('updating');
          setApiReachable(false);
        }
        return false;
      }
    }

    const tick = async () => {
      void checkWeb();
      const reachable = await checkApi();
      if (!active) return;
      // Polling adattivo: più rapido quando l'API è giù, per cogliere il ritorno.
      timer = setTimeout(tick, reachable ? POLL_OK_MS : POLL_DOWN_MS);
    };
    void tick();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const updating = web === 'updating' || api === 'updating';
  return { web, api, updating, apiReachable, apiVersion };
}

/**
 * Context che esegue il polling UNA volta sola e lo condivide tra i consumer
 * (footer + overlay), evitando richieste duplicate a /health e /version.json.
 */
const DeployStatusContext = React.createContext<DeployStatus | null>(null);

export function DeployStatusProvider({ children }: { children: React.ReactNode }) {
  const value = usePollDeployStatus();
  return <DeployStatusContext.Provider value={value}>{children}</DeployStatusContext.Provider>;
}

/** Legge lo stato condiviso; fuori dal provider ricade su valori neutri. */
export function useDeployStatus(): DeployStatus {
  const ctx = React.useContext(DeployStatusContext);
  return ctx ?? { web: 'ok', api: 'unknown', updating: false, apiReachable: true, apiVersion: null };
}

/** Nome app esportato per comodità dei consumer del footer. */
export { APP_NAME };
