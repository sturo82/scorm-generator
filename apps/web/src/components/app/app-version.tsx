'use client';

import { useDeployStatus, type PartStatus } from '@/lib/use-deploy-status';

/**
 * Versione dell'app mostrata in modo discreto (footer), con indicatore di stato
 * di aggiornamento di web e API. Valori iniettati al build-time del web dalla CI:
 *  - NEXT_PUBLIC_APP_VERSION  = sha corto del commit (o "dev" in locale)
 *  - NEXT_PUBLIC_BUILD_TIME   = ISO datetime del build (o vuoto in locale)
 * L'indicatore (vedi useDeployStatus) diventa ambra e animato quando una nuova
 * versione di web o API è in pubblicazione.
 */
export function AppVersion() {
  const rawVersion = process.env.NEXT_PUBLIC_APP_VERSION || 'dev';
  // sha corto (7) se è un commit hash; altrimenti il valore così com'è.
  const version = /^[0-9a-f]{40}$/i.test(rawVersion) ? rawVersion.slice(0, 7) : rawVersion;
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME || '';

  const { web, api, updating } = useDeployStatus();

  // Data leggibile e compatta (locale IT), senza secondi.
  let dateLabel = '';
  if (buildTime) {
    const d = new Date(buildTime);
    if (!Number.isNaN(d.getTime())) {
      // Forziamo il fuso italiano: BUILD_TIME è in UTC (date -u). Senza timeZone
      // l'orario dipenderebbe dal fuso del browser (mostrava 08:33 invece di 10:33).
      dateLabel = d.toLocaleString('it-IT', {
        timeZone: 'Europe/Rome',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  }

  return (
    <footer className="flex items-center justify-end gap-3 px-4 pb-3 pt-2 md:px-6 lg:px-8">
      <StatusDot label="Web" status={web} />
      <StatusDot label="API" status={api} />
      <span
        className="select-none text-[11px] text-muted-foreground/60"
        title={buildTime ? `Build: ${buildTime}` : undefined}
      >
        v{version}
        {dateLabel ? ` · ${dateLabel}` : ''}
        {updating ? ' · aggiornamento in corso…' : ''}
      </span>
    </footer>
  );
}

/** Pallino di stato di una parte (web/api): verde = ok, ambra pulsante = updating. */
function StatusDot({ label, status }: { label: string; status: PartStatus }) {
  const title =
    status === 'updating'
      ? `${label}: aggiornamento in corso`
      : status === 'ok'
        ? `${label}: aggiornato`
        : `${label}: stato sconosciuto`;

  if (status === 'updating') {
    return (
      <span className="inline-flex items-center gap-1" title={title} aria-label={title}>
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-500/70" />
          <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
        </span>
        <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">{label}</span>
      </span>
    );
  }

  const dotColor =
    status === 'ok' ? 'bg-emerald-500' : 'bg-muted-foreground/40';
  return (
    <span className="inline-flex items-center gap-1" title={title} aria-label={title}>
      <span className={`inline-flex size-2 rounded-full ${dotColor}`} />
      <span className="text-[11px] text-muted-foreground/50">{label}</span>
    </span>
  );
}
