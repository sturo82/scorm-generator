import * as React from 'react';

/** Intestazione di pagina riusabile: titolo con accento brand, descrizione e
 *  azioni a destra. La barretta a gradiente e il titolo rinforzano la palette. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-start gap-3">
        {/* Barretta d'accento: gradiente brand visibile in testa a ogni pagina. */}
        <span
          aria-hidden
          className="mt-1 h-8 w-1.5 shrink-0 rounded-full bg-gradient-to-b from-primary to-primary/30"
        />
        <div className="space-y-1">
          <h1 className="brand-text-gradient text-2xl font-bold tracking-tight md:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
