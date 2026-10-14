/**
 * Versione dell'app mostrata in modo discreto (footer). Valori iniettati al
 * build-time del web dalla CI:
 *  - NEXT_PUBLIC_APP_VERSION  = sha corto del commit (o "dev" in locale)
 *  - NEXT_PUBLIC_BUILD_TIME   = ISO datetime del build (o vuoto in locale)
 * Serve a capire a colpo d'occhio quando il deploy è effettivamente aggiornato.
 */
export function AppVersion() {
  const rawVersion = process.env.NEXT_PUBLIC_APP_VERSION || 'dev';
  // sha corto (7) se è un commit hash; altrimenti il valore così com'è.
  const version = /^[0-9a-f]{40}$/i.test(rawVersion) ? rawVersion.slice(0, 7) : rawVersion;
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME || '';

  // Data leggibile e compatta (locale IT), senza secondi.
  let dateLabel = '';
  if (buildTime) {
    const d = new Date(buildTime);
    if (!Number.isNaN(d.getTime())) {
      dateLabel = d.toLocaleString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  }

  return (
    <footer className="px-4 pb-3 pt-2 text-right md:px-6 lg:px-8">
      <span
        className="select-none text-[11px] text-muted-foreground/60"
        title={buildTime ? `Build: ${buildTime}` : undefined}
      >
        v{version}
        {dateLabel ? ` · ${dateLabel}` : ''}
      </span>
    </footer>
  );
}
