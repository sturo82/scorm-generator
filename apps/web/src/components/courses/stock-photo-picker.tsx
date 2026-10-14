'use client';

import * as React from 'react';
import { Search, Upload } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useSearchStockImages } from '@/lib/api/hooks';
import type { StockImageResult } from '@/lib/api/types';

/** Destinazione selezionabile (es. block con immagini di una lezione). */
export interface StockTarget {
  id: string;
  label: string;
  count: number;
}

/**
 * Dialog riusabile di ricerca immagini stock royalty-free (Unsplash/Pexels via
 * server). Mostra la casella di ricerca, la griglia dei risultati con credito
 * autore sempre visibile e, se sono passati più `targets`, un selettore della
 * destinazione. In "modalità copertina" (nessun target) la selezione passa solo
 * la foto. Alla scelta il chiamante scarica e collega l'immagine.
 */
export function StockPhotoPicker({
  open,
  courseId,
  title = "Cerca un'immagine stock royalty-free",
  targets,
  initialQuery,
  saving,
  onClose,
  onSelect,
  onUpload,
}: {
  open: boolean;
  courseId: string;
  title?: string;
  /** Se presente, mostra un selettore di destinazione (block). Omesso = copertina. */
  targets?: StockTarget[];
  /** Termine di ricerca iniziale (es. dal placeholderPrompt del block). */
  initialQuery?: string;
  saving: boolean;
  onClose: () => void;
  /** targetId è l'id scelto fra `targets`, oppure undefined in modalità copertina. */
  onSelect: (photo: StockImageResult, targetId?: string) => void;
  /**
   * Se presente, abilita l'upload di un'immagine DAL PC: viene mostrato il
   * pulsante "Carica dal PC" che apre il selettore file e invoca questo callback
   * con il file scelto e la destinazione selezionata. Omesso = nessun upload
   * (es. modalità copertina, dove l'upload è gestito altrove).
   */
  onUpload?: (file: File, targetId?: string) => void;
}) {
  const [term, setTerm] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [targetId, setTargetId] = React.useState<string>('');
  const search = useSearchStockImages(courseId, query);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const hasTargets = Array.isArray(targets) && targets.length > 0;

  React.useEffect(() => {
    if (hasTargets && !targets!.some((t) => t.id === targetId)) {
      setTargetId(targets![0].id);
    }
  }, [hasTargets, targets, targetId]);

  React.useEffect(() => {
    if (open) {
      // All'apertura, se è fornito un termine iniziale (es. dalla descrizione
      // del placeholder del block) precompila ed esegue subito la ricerca.
      if (initialQuery && initialQuery.trim()) {
        const q = initialQuery.trim().slice(0, 80);
        setTerm(q);
        setQuery(q);
      }
    } else {
      setTerm('');
      setQuery('');
    }
    // Volutamente solo su `open`: non vogliamo ri-eseguire se initialQuery cambia
    // mentre il dialog è già aperto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const providerLabel = search.data?.provider
    ? search.data.provider.charAt(0).toUpperCase() + search.data.provider.slice(1)
    : null;

  // In modalità copertina non serve un target; con targets serve averne uno.
  const canSelect = !hasTargets || !!targetId;

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(term.trim());
        }}
      >
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Es. teamwork, sicurezza sul lavoro, laboratorio…"
          className="h-9"
          autoFocus
        />
        <Button type="submit" size="sm" disabled={!term.trim()}>
          <Search className="size-4" /> Cerca
        </Button>
        {onUpload && (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving || !canSelect}
              onClick={() => fileInputRef.current?.click()}
              title="Carica un'immagine dal tuo computer"
            >
              <Upload className="size-4" /> Carica dal PC
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Reset del valore così lo stesso file può essere riselezionato.
                e.target.value = '';
                if (file) onUpload(file, hasTargets ? targetId : undefined);
              }}
            />
          </>
        )}
      </form>

      {hasTargets && targets!.length > 1 && (
        <Label className="mb-3 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Associa a:</span>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="h-9 flex-1 rounded-md border bg-background px-2 text-sm"
          >
            {targets!.map((t, i) => (
              <option key={t.id} value={t.id}>
                {`${i + 1}. ${t.label}${t.count > 1 ? ` (${t.count} immagini)` : ''}`}
              </option>
            ))}
          </select>
        </Label>
      )}

      {search.isError ? (
        <p className="text-sm text-destructive">
          {/501|non configurata/i.test(String((search.error as Error)?.message))
            ? 'Libreria immagini stock non configurata sul server.'
            : 'Ricerca non riuscita. Riprova.'}
        </p>
      ) : !query ? (
        <p className="text-sm text-muted-foreground">
          Digita una parola chiave e premi «Cerca». Le immagini sono royalty-free; il credito
          all&apos;autore viene salvato e mostrato automaticamente.
          {onUpload && ' In alternativa usa «Carica dal PC» per inserire una tua immagine.'}
        </p>
      ) : search.isLoading ? (
        <p className="text-sm text-muted-foreground">Cerco immagini…</p>
      ) : (search.data?.results.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">Nessun risultato per «{query}».</p>
      ) : (
        <>
          {providerLabel && (
            <p className="mb-2 text-xs text-muted-foreground">Risultati forniti da {providerLabel}</p>
          )}
          <div className="grid max-h-[420px] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {search.data!.results.map((photo) => (
              <button
                key={`${photo.provider}-${photo.id}`}
                type="button"
                disabled={saving || !canSelect}
                onClick={() => onSelect(photo, hasTargets ? targetId : undefined)}
                className="group flex flex-col overflow-hidden rounded-lg border text-left transition-colors hover:border-primary/50 disabled:opacity-60"
              >
                <div className="relative aspect-[4/3] w-full bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element -- miniatura remota del provider stock */}
                  <img src={photo.thumbUrl} alt={photo.alt} loading="lazy" className="size-full object-cover" />
                </div>
                <div className="p-1.5">
                  <p className="line-clamp-1 text-[11px] text-muted-foreground">
                    Foto di{' '}
                    {photo.authorUrl ? (
                      <a
                        href={photo.authorUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline hover:text-foreground"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {photo.authorName}
                      </a>
                    ) : (
                      <span className="text-foreground">{photo.authorName}</span>
                    )}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}
