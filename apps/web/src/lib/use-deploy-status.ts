'use client';

import * as React from 'react';
import { APP_NAME } from './app-brand';

/**
 * Stato di aggiornamento di web e API, per l'indicatore nel footer.
 *
 * Il frontend non ha accesso allo stato di App Runner/CI; usa segnali osservabili:
 *  - WEB: confronta la versione del bundle in esecuzione (NEXT_PUBLIC_APP_VERSION)
 *    con quella pubblicata in /version.json (servito no-cache). Se differiscono,
 *    è stata pubblicata una versione più recente → "updating" (serve ricaricare).
 *  - API: interroga /health (espone { version }). Se non risponde o è degraded,
 *    sta ripartendo (deploy in corso) → "updating". Se la versione cambia rispetto
 *    a quella vista al primo caricamento, è stata aggiornata → "updating" finché
 *    non si ricarica il contesto.
 */

export type PartStatus = 'ok' | 'updating' | 'unknown';

export interface DeployStatus {
  web: PartStatus;
  api: PartStatus;
  /** Vero se web o api stanno aggiornando (per l'indicatore animato). */
  updating: boolean;
  /** Versione dell'API corrente (sha corto), se nota. */
  apiVersion: string | null;
}

const WEB_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'dev';
const POLL_MS = 20_000;

/** Normalizza uno sha a 7 char (per confronto/visualizzazione coerente). */
function shortSha(v: string | null | undefined): string | null {
  if (!v) return null;
  return /^[0-9a-f]{40}$/i.test(v) ? v.slice(0, 7) : v;
}

export function useDeployStatus(): DeployStatus {
  const [web, setWeb] = React.useState<PartStatus>('ok');
  const [api, setApi] = React.useState<PartStatus>('unknown');
  const [apiVersion, setApiVersion] = React.useState<string | null>(null);
  // Versione API al primo rilevamento: un cambiamento successivo = aggiornata.
  const apiBaseline = React.useRef<string | null>(null);

  React.useEffect(() => {
    // In dev (versione "dev") non ha senso: nessun deploy da monitorare.
    if (WEB_VERSION === 'dev') return;

    let active = true;
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

    async function checkApi() {
      if (!apiBase) {
        if (active) setApi('unknown');
        return;
      }
      try {
        const res = await fetch(`${apiBase}/health?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) {
          if (active) setApi('updating'); // 5xx/avvio: sta ripartendo
          return;
        }
        const doc = (await res.json()) as { version?: string };
        const v = shortSha(doc.version);
        if (!active) return;
        setApiVersion(v);
        if (apiBaseline.current === null) apiBaseline.current = v;
        // Versione cambiata rispetto al primo rilevamento → aggiornata.
        setApi(apiBaseline.current && v && apiBaseline.current !== v ? 'updating' : 'ok');
      } catch {
        if (active) setApi('updating'); // irraggiungibile: probabile deploy
      }
    }

    const tick = () => {
      void checkWeb();
      void checkApi();
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const updating = web === 'updating' || api === 'updating';
  return { web, api, updating, apiVersion };
}

/** Nome app esportato per comodità dei consumer del footer. */
export { APP_NAME };
