'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Mic, Rss, Search, Wand2 } from 'lucide-react';
import { PODCAST_LIMITS, type PodcastEpisodeView, type PodcastScript, type UpdatePodcastEpisodes } from '@scorm/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useDeletePodcast, usePodcast, usePodcastActions, usePodcastEstimate } from '@/lib/api/hooks';
import { EpisodeCard } from './episode-card';
import { FeedPanel } from './feed-panel';
import { IdeasCard } from './ideas-card';
import { NewEpisodeDialog } from './new-episode-dialog';
import { PodcastHero } from './podcast-hero';
import { errText } from './podcast-labels';
import { SettingsDialog } from './settings-dialog';

const PAGE = 10;
type Filter = 'all' | 'todo' | 'ready' | 'published';
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
  const [tab, setTab] = React.useState<'episodes' | 'feed'>('episodes');
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<Filter>('all');
  const [recentFirst, setRecentFirst] = React.useState<boolean | null>(null);
  const [shown, setShown] = React.useState(PAGE);
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
  // Con molte puntate si parte dalle più recenti (sono quelle su cui si lavora).
  const desc = recentFirst ?? episodes.length > PAGE;
  const q2 = query.trim().toLowerCase();
  const matches = (e: PodcastEpisodeView) => {
    if (q2 && !`${e.title} ${e.summary}`.toLowerCase().includes(q2)) return false;
    if (filter === 'todo') return !e.script || !e.hasAudio || e.audioStale;
    if (filter === 'ready') return e.hasAudio && !e.audioStale && !e.published;
    if (filter === 'published') return e.published;
    return true;
  };
  const indexed = episodes.map((e, i) => ({ e, i })).filter(({ e }) => matches(e));
  const ordered = desc ? [...indexed].reverse() : indexed;
  const visible = ordered.slice(0, shown);
  const reorder = !desc && !q2 && filter === 'all';
  const feedLive = p.episodes.some((e) => e.published);

  const saveList = (list: UpdatePodcastEpisodes['episodes'], ok?: string) => run(act.saveEpisodes.mutateAsync({ episodes: list }), ok);
  const move = (i: number, dir: -1 | 1) => {
    const list = toInput(episodes);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    void saveList(list);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PodcastHero
        podcast={p}
        busy={busy}
        canAdd={episodes.length < PODCAST_LIMITS.maxEpisodes}
        onNewEpisode={() => setNewEpisode({ open: true, initial: null })}
        onSettings={() => setSettingsOpen(true)}
        onDelete={() => setConfirmDelete(true)}
        onOpenFeed={() => setTab('feed')}
      />
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

      <div role="tablist" aria-label="Sezioni del podcast" className="flex gap-1 border-b">
        {([
          ['episodes', 'Puntate', String(episodes.length)],
          ['feed', 'Feed RSS e pubblicazione', feedLive ? 'attivo' : ''],
        ] as const).map(([id2, label, badge]) => (
          <button
            key={id2}
            role="tab"
            aria-selected={tab === id2}
            onClick={() => setTab(id2)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${tab === id2 ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {id2 === 'feed' && <Rss className="size-4" />}
            {label}
            {badge && <span className="rounded-full bg-muted px-2 text-xs text-muted-foreground">{badge}</span>}
          </button>
        ))}
      </div>

      {tab === 'feed' && <FeedPanel podcast={p} busy={busy} />}

      {tab === 'episodes' && (
        <div className="space-y-4">
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
          {episodes.length > 4 && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} placeholder="Cerca una puntata…" aria-label="Cerca una puntata" className="pl-9" />
              </div>
              <Select aria-label="Filtra le puntate" value={filter} onChange={(e) => { setFilter(e.target.value as Filter); setShown(PAGE); }} className="sm:w-52">
                <option value="all">Tutte le puntate</option>
                <option value="todo">Da completare</option>
                <option value="ready">Pronte da pubblicare</option>
                <option value="published">Pubblicate</option>
              </Select>
              <Select aria-label="Ordine" value={desc ? 'recent' : 'first'} onChange={(e) => setRecentFirst(e.target.value === 'recent')} className="sm:w-48">
                <option value="first">Dalla prima</option>
                <option value="recent">Dalla più recente</option>
              </Select>
            </div>
          )}
          {episodes.length > 0 && indexed.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nessuna puntata corrisponde alla ricerca.</p>}
          <div className="space-y-3">
            {visible.map(({ e, i }) => (
              <EpisodeCard
                key={e.id}
                podcast={p}
                episode={e}
                index={i}
                total={episodes.length}
                reorder={reorder}
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
          {ordered.length > shown && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
                Mostra altre {Math.min(PAGE, ordered.length - shown)} di {ordered.length - shown}
              </Button>
            </div>
          )}
        </div>
      )}

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
