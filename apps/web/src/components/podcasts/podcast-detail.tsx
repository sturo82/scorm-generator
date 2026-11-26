'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Mic, Plus, Settings2, Trash2, Wand2 } from 'lucide-react';
import { PODCAST_LIMITS, type PodcastEpisodeView, type PodcastScript, type UpdatePodcastEpisodes } from '@scorm/contracts';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useDeletePodcast, usePodcast, usePodcastActions, usePodcastEstimate } from '@/lib/api/hooks';
import { EpisodeCard } from './episode-card';
import { FeedPanel } from './feed-panel';
import { IdeasCard } from './ideas-card';
import { NewEpisodeDialog } from './new-episode-dialog';
import { PODCAST_LANGUAGES, errText } from './podcast-labels';
import { SettingsDialog } from './settings-dialog';

const fmt = (n: number) => n.toLocaleString('it-IT');

const toInput = (list: PodcastEpisodeView[]): UpdatePodcastEpisodes['episodes'] =>
  list.map((e) => ({ id: e.id, title: e.title, summary: e.summary, targetMinutes: e.targetMinutes }));

/** Pagina di una serie: stato del lavoro, puntate, feed. L'id arriva dall'indirizzo (?id=…). */
export function PodcastDetail() {
  const router = useRouter();
  const toast = useToast();
  // undefined = indirizzo non ancora letto; null = manca l'id.
  const [id, setId] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => setId(new URLSearchParams(window.location.search).get('id')), []);

  const q = usePodcast(id ?? null);
  const act = usePodcastActions(id ?? '');
  const estimate = usePodcastEstimate(id ?? null);
  const del = useDeletePodcast();
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [removing, setRemoving] = React.useState<PodcastEpisodeView | null>(null);
  const [newEpisode, setNewEpisode] = React.useState<{ open: boolean; initial: { title: string; summary: string } | null }>({ open: false, initial: null });

  async function run<T>(p: Promise<T>, ok?: string) {
    try {
      await p;
      if (ok) toast.show(ok, 'success');
    } catch (e) {
      toast.show(errText(e), 'error');
    }
  }

  if (id === undefined || (id && q.isLoading)) return <Skeleton className="h-64" />;
  if (!id) {
    return (
      <p className="text-sm">
        Podcast non indicato. <Link href="/podcasts" className="underline">Torna all&apos;elenco</Link>.
      </p>
    );
  }
  if (q.isError || !q.data) {
    return (
      <p className="text-sm text-destructive">
        Non trovo questo podcast. <Link href="/podcasts" className="underline">Torna all&apos;elenco</Link>.
      </p>
    );
  }

  const p = q.data;
  const episodes = p.episodes;
  const busy = episodes.some((e) => e.state === 'WRITING' || e.state === 'VOICING');
  const writing = episodes.filter((e) => e.state === 'WRITING').length;
  const voicing = episodes.filter((e) => e.state === 'VOICING').length;
  const needScripts = episodes.filter((e) => !e.script && e.state !== 'WRITING' && e.state !== 'VOICING').length;
  const needAudio = episodes.filter((e) => e.script && (!e.hasAudio || e.audioStale) && e.state !== 'WRITING' && e.state !== 'VOICING').length;
  const est = estimate.data;
  const lang = PODCAST_LANGUAGES.find((l) => l.code === p.language.slice(0, 2))?.label ?? p.language;

  const saveList = (list: UpdatePodcastEpisodes['episodes'], ok?: string) => run(act.saveEpisodes.mutateAsync({ episodes: list }), ok);
  const move = (i: number, dir: -1 | 1) => {
    const list = toInput(episodes);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    void saveList(list);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/podcasts">
          <ArrowLeft /> Podcast
        </Link>
      </Button>
      <PageHeader
        title={p.title}
        description={`${lang} · ${episodes.length === 0 ? 'nessuna puntata' : `${episodes.length} ${episodes.length === 1 ? 'puntata' : 'puntate'}`} · ${p.hosts.map((h) => h.name).join(' e ')}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setSettingsOpen(true)}>
              <Settings2 /> Impostazioni
            </Button>
            <Button variant="outline" onClick={() => setConfirmDelete(true)} disabled={busy} aria-label="Elimina il podcast">
              <Trash2 />
            </Button>
          </div>
        }
      />
      {p.brief.topic && <p className="text-sm text-muted-foreground">{p.brief.topic}</p>}

      {busy && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin text-primary" />
              {writing > 0 && `Sto scrivendo (${writing} ${writing === 1 ? 'puntata' : 'puntate'}). `}
              {voicing > 0 && `Sto registrando (${voicing} ${voicing === 1 ? 'puntata' : 'puntate'}). `}
              Puoi lasciare la pagina: il lavoro prosegue.
            </p>
            <Button variant="outline" size="sm" disabled={act.cancel.isPending} onClick={() => void run(act.cancel.mutateAsync(), 'Mi fermo dopo la puntata in corso')}>
              Annulla
            </Button>
          </CardContent>
        </Card>
      )}

      {!busy && (needScripts > 0 || needAudio > 0) && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {needScripts > 0 && (
                <Button onClick={() => void run(act.writeScripts.mutateAsync(undefined))} disabled={act.writeScripts.isPending}>
                  {act.writeScripts.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />} Scrivi {needScripts === 1 ? 'il copione' : `i ${needScripts} copioni`}
                </Button>
              )}
              {needAudio > 0 && (
                <Button variant={needScripts > 0 ? 'outline' : 'default'} onClick={() => void run(act.recordAudio.mutateAsync(undefined))} disabled={act.recordAudio.isPending}>
                  {act.recordAudio.isPending ? <Loader2 className="animate-spin" /> : <Mic />} Registra l&apos;audio ({needAudio})
                </Button>
              )}
            </div>
            {est?.billed && est.priced && est.total > 0 && (
              <p className="text-xs text-muted-foreground">
                Costo stimato di quello che manca: <strong>{fmt(est.total)} crediti</strong>
                {est.lines.length > 1 ? ` (${est.lines.map((l) => `${l.kind === 'scripts' ? 'copioni' : l.kind === 'audio' ? 'audio' : 'piano'} ${fmt(l.credits ?? 0)}`).join(', ')})` : ''}. Si paga solo quello che viene
                prodotto.
              </p>
            )}
            <p className="text-xs text-muted-foreground">Prima di registrare puoi rileggere e correggere i copioni. Dopo la registrazione, modificare un copione rende da rifare l&apos;audio.</p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-start gap-2">
        <Button onClick={() => setNewEpisode({ open: true, initial: null })} disabled={busy || episodes.length >= PODCAST_LIMITS.maxEpisodes}>
          <Plus /> Nuova puntata
        </Button>
      </div>
      <IdeasCard podcast={p} disabled={busy} onUse={(idea) => setNewEpisode({ open: true, initial: idea })} />

      {episodes.length === 0 && (
        <Card>
          <CardContent className="space-y-2 py-10 text-center">
            <Mic className="mx-auto size-7 text-muted-foreground" aria-hidden />
            <p className="font-medium">Il podcast è pronto, ma non ha ancora puntate</p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              Aggiungi la prima quando vuoi, con il suo argomento e le sue fonti, oppure chiedi qualche idea. Le puntate si aggiungono una alla volta, man mano che le prepari.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {episodes.map((e, i) => (
          <EpisodeCard
            key={e.id}
            podcast={p}
            episode={e}
            index={i}
            total={episodes.length}
            busy={busy}
            saving={act.saveEpisodes.isPending || act.saveScript.isPending}
            onMove={(dir) => move(i, dir)}
            onRemove={() => setRemoving(e)}
            onSaveTitle={(title, summary) => void saveList(toInput(episodes).map((x) => (x.id === e.id ? { ...x, title, summary } : x)), 'Puntata aggiornata')}
            onSaveScript={(script: PodcastScript) => void run(act.saveScript.mutateAsync({ episodeId: e.id, script }), 'Copione salvato')}
            onWriteScript={() => void run(act.writeScripts.mutateAsync([e.id]))}
            onRecord={() => void run(act.recordAudio.mutateAsync([e.id]))}
            onPublish={() => void run(act.publish.mutateAsync(e.id), 'Puntata pubblicata')}
            onUnpublish={() => void run(act.unpublish.mutateAsync(e.id), 'Puntata ritirata')}
          />
        ))}
      </div>

      <FeedPanel podcast={p} busy={busy} />

      <SettingsDialog podcast={p} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <NewEpisodeDialog podcast={p} open={newEpisode.open} initial={newEpisode.initial} onClose={() => setNewEpisode({ open: false, initial: null })} />
      <ConfirmDialog
        open={confirmDelete}
        title="Eliminare il podcast?"
        message="Si eliminano la serie, le puntate, l'audio e il feed. Gli ascoltatori che lo seguono non lo troveranno più."
        loading={del.isPending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            await del.mutateAsync(p.id);
            router.push('/podcasts');
          } catch (e) {
            toast.show(errText(e), 'error');
            setConfirmDelete(false);
          }
        }}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        title="Togliere la puntata?"
        message={removing ? `«${removing.title}» verrà eliminata con il suo audio${removing.published ? ' e ritirata dal feed' : ''}.` : ''}
        loading={act.saveEpisodes.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await saveList(toInput(episodes).filter((x) => x.id !== removing.id), 'Puntata tolta');
          setRemoving(null);
        }}
      />
    </div>
  );
}
