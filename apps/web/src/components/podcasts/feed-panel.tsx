'use client';
import * as React from 'react';
import { Copy, ImageUp, KeyRound, Loader2, TriangleAlert } from 'lucide-react';
import { PODCAST_COVER, type PodcastView } from '@scorm/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { usePodcastActions } from '@/lib/api/hooks';
import { errText } from './podcast-labels';

/** Feed RSS della serie: indirizzo, visibilità, codice segreto e copertina. */
export function FeedPanel({ podcast, busy }: { podcast: PodcastView; busy: boolean }) {
  const toast = useToast();
  const act = usePodcastActions(podcast.id);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const publishedCount = podcast.episodes.filter((e) => e.published).length;

  async function copy() {
    if (!podcast.feedUrl) return;
    try {
      await navigator.clipboard.writeText(podcast.feedUrl);
      toast.show('Indirizzo del feed copiato', 'success');
    } catch {
      toast.show('Non riesco a copiare: selezionalo a mano', 'error');
    }
  }

  async function run<T>(p: Promise<T>, ok: string) {
    try {
      await p;
      toast.show(ok, 'success');
    } catch (e) {
      toast.show(errText(e), 'error');
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="font-semibold">Feed RSS</h2>
          <p className="text-xs text-muted-foreground">
            È l&apos;indirizzo che si incolla in Spotify, Apple Podcasts o in un&apos;altra piattaforma. Contiene solo le puntate pubblicate ({publishedCount}).
          </p>
        </div>

        {!podcast.publishingEnabled ? (
          <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            La pubblicazione non è ancora attiva su questo ambiente: puoi creare e ascoltare le puntate, ma il feed non è disponibile.
          </p>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                readOnly
                aria-label="Indirizzo del feed"
                value={podcast.feedUrl ?? ''}
                onFocus={(e) => e.currentTarget.select()}
                className="h-10 min-w-0 flex-1 rounded-md border bg-muted/40 px-3 font-mono text-xs"
              />
              <Button variant="outline" onClick={() => void copy()}>
                <Copy /> Copia
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="feed-vis">
                  Chi può usare il feed
                </label>
                <Select
                  id="feed-vis"
                  value={podcast.visibility}
                  disabled={busy || act.setFeed.isPending}
                  onChange={(e) => void run(act.setFeed.mutateAsync(e.target.value as 'PUBLIC' | 'PRIVATE'), 'Visibilità aggiornata')}
                >
                  <option value="PRIVATE">Privato: solo chi ha l&apos;indirizzo (piattaforme custom)</option>
                  <option value="PUBLIC">Pubblico: Spotify, Apple Podcasts e altri elenchi</option>
                </Select>
              </div>
              {podcast.visibility === 'PRIVATE' && (
                <Button
                  variant="outline"
                  disabled={busy || act.rotateToken.isPending}
                  onClick={() => {
                    if (confirm('Rigenerare il codice? Il vecchio indirizzo smetterà di funzionare.')) void run(act.rotateToken.mutateAsync(), 'Nuovo indirizzo generato');
                  }}
                >
                  {act.rotateToken.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />} Nuovo codice
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {podcast.visibility === 'PRIVATE'
                ? 'Il feed privato è protetto solo dal codice nell\u2019indirizzo: chi lo ha può ascoltare le puntate pubblicate. Spotify e Apple richiedono un feed pubblico.'
                : 'Il feed pubblico può essere letto da chiunque conosca l\u2019indirizzo e inviato agli elenchi dei podcast.'}
            </p>
          </>
        )}

        <div className="flex flex-wrap items-center gap-4 border-t pt-4">
          {podcast.cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- anteprima di un file firmato
            <img src={podcast.cover.url} alt="Copertina del podcast" className="size-20 rounded-md border object-cover" />
          ) : (
            <div className="grid size-20 place-items-center rounded-md border border-dashed text-xs text-muted-foreground">Nessuna</div>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium">Copertina</p>
            <p className="text-xs text-muted-foreground">
              Quadrata, da {PODCAST_COVER.minPx} a {PODCAST_COVER.maxPx} px, JPEG o PNG (richiesta da Apple Podcasts).
              {podcast.cover && ` Questa è ${podcast.cover.width}×${podcast.cover.height}${podcast.cover.ok ? ': va bene.' : '.'}`}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void run(act.uploadCover.mutateAsync(f), 'Copertina caricata');
              }}
            />
            <Button size="sm" variant="outline" disabled={act.uploadCover.isPending} onClick={() => fileRef.current?.click()}>
              {act.uploadCover.isPending ? <Loader2 className="animate-spin" /> : <ImageUp />} {podcast.cover ? 'Cambia' : 'Carica'} la copertina
            </Button>
          </div>
        </div>

        {podcast.publishingEnabled && publishedCount === 0 && (
          <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            Il feed non contiene ancora nessuna puntata: Spotify e Apple Podcasts lo rifiutano finché non ne pubblichi almeno una (scheda Puntate, pulsante Pubblica).
          </p>
        )}
        {podcast.feedWarnings.length > 0 && (
          <ul className="list-disc space-y-0.5 rounded-md bg-muted/50 py-2 pl-7 pr-3 text-xs text-muted-foreground">
            {podcast.feedWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
