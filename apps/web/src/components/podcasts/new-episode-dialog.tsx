'use client';
import * as React from 'react';
import { FileText, Loader2, Rss } from 'lucide-react';
import { PODCAST_LIMITS, type PodcastArticleRef, type PodcastView } from '@scorm/contracts';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { getApiClient } from '@/lib/api/client';
import { useKnowledge, usePodcastActions, usePodcastEstimateNew } from '@/lib/api/hooks';
import { errText } from './podcast-labels';

const fmt = (n: number) => n.toLocaleString('it-IT');

/**
 * Aggiunge una puntata alla serie. Ogni puntata ha il suo argomento, le sue indicazioni e le sue fonti
 * (documenti della knowledge e articoli di un feed RSS). Si può solo aggiungere, oppure aggiungere e
 * scrivere subito il copione.
 */
export function NewEpisodeDialog({
  podcast,
  open,
  initial,
  onClose,
}: {
  podcast: PodcastView;
  open: boolean;
  /** Idea di partenza (da "Idee per le prossime puntate"). */
  initial?: { title: string; summary: string } | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const act = usePodcastActions(podcast.id);
  const knowledge = useKnowledge('GLOBAL');
  const [title, setTitle] = React.useState('');
  const [summary, setSummary] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [minutes, setMinutes] = React.useState(podcast.brief.episodeMinutes);
  const [docIds, setDocIds] = React.useState<string[]>([]);
  const [feedUrl, setFeedUrl] = React.useState('');
  const [feedLoading, setFeedLoading] = React.useState(false);
  const [feedItems, setFeedItems] = React.useState<Array<{ title: string; link?: string; summary: string }>>([]);
  const [articles, setArticles] = React.useState<PodcastArticleRef[]>([]);
  const [busy, setBusy] = React.useState(false);
  const estimate = usePodcastEstimateNew(minutes, podcast.id);
  const readyDocs = React.useMemo(() => (knowledge.data ?? []).filter((d) => d.status === 'READY'), [knowledge.data]);

  // Ogni volta che si apre: campi puliti, o precompilati dall'idea scelta.
  React.useEffect(() => {
    if (!open) return;
    setTitle(initial?.title ?? '');
    setSummary(initial?.summary ?? '');
    setNotes('');
    setMinutes(podcast.brief.episodeMinutes);
    setDocIds([]);
    setFeedItems([]);
    setArticles([]);
    setFeedUrl('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  async function loadFeed() {
    if (!feedUrl.trim()) return;
    setFeedLoading(true);
    try {
      const res = await getApiClient().listPodcastFeedItems(feedUrl.trim());
      setFeedItems(res.items.filter((i) => i.link));
      if (res.items.length === 0) toast.show('Il feed non ha articoli', 'error');
    } catch (e) {
      toast.show(errText(e, 'Feed non raggiungibile'), 'error');
    } finally {
      setFeedLoading(false);
    }
  }

  function toggleArticle(item: { title: string; link?: string }, on: boolean) {
    if (!item.link) return;
    setArticles((cur) => {
      if (!on) return cur.filter((a) => a.url !== item.link);
      if (cur.length >= PODCAST_LIMITS.maxArticles) {
        toast.show(`Al massimo ${PODCAST_LIMITS.maxArticles} articoli`, 'error');
        return cur;
      }
      return [...cur, { title: item.title, url: item.link! }];
    });
  }

  async function submit(writeNow: boolean) {
    setBusy(true);
    try {
      const view = await act.addEpisode.mutateAsync({
        title: title.trim(),
        summary: summary.trim(),
        notes: notes.trim(),
        targetMinutes: minutes,
        knowledgeDocIds: docIds,
        articles,
      });
      const added = view.episodes[view.episodes.length - 1];
      if (writeNow && added) {
        try {
          await act.writeScripts.mutateAsync([added.id]);
          toast.show('Puntata aggiunta: scrivo il copione', 'success');
        } catch (e) {
          toast.show(`Puntata aggiunta, ma il copione non è partito: ${errText(e)}`, 'error');
        }
      } else {
        toast.show('Puntata aggiunta', 'success');
      }
      onClose();
    } catch (e) {
      toast.show(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const est = estimate.data;
  const valid = title.trim().length > 0;

  return (
    <Dialog open={open} onClose={onClose} title="Nuova puntata" size="lg">
      <div className="max-h-[68vh] space-y-4 overflow-auto pr-1">
        <div className="space-y-1.5">
          <Label htmlFor="ne-title">Titolo</Label>
          <Input id="ne-title" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} placeholder="Es. Le parole che pesano" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ne-sum">Di cosa parla</Label>
          <Textarea id="ne-sum" rows={3} maxLength={1000} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Argomento e taglio, in due o tre frasi" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ne-notes">Indicazioni per il copione (facoltative)</Label>
          <Textarea id="ne-notes" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Cose da dire, esempi da usare, punti da evitare" />
        </div>
        <div className="max-w-[12rem] space-y-1.5">
          <Label htmlFor="ne-min">Durata (minuti)</Label>
          <Input
            id="ne-min"
            type="number"
            min={PODCAST_LIMITS.minMinutes}
            max={PODCAST_LIMITS.maxMinutes}
            value={minutes}
            onChange={(e) => setMinutes(Math.min(PODCAST_LIMITS.maxMinutes, Math.max(PODCAST_LIMITS.minMinutes, Math.round(Number(e.target.value) || PODCAST_LIMITS.minMinutes))))}
          />
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Fonti di questa puntata</p>
            <p className="text-xs text-muted-foreground">Facoltative. Con documenti o articoli la puntata si basa su quelli e non inventa oltre.</p>
          </div>
          {readyDocs.length > 0 && (
            <div className="flex max-h-36 flex-col gap-1 overflow-auto rounded-md border p-2">
              {readyDocs.map((d) => (
                <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent/50">
                  <input
                    type="checkbox"
                    className="size-4 accent-[hsl(var(--primary))]"
                    checked={docIds.includes(d.id)}
                    onChange={(e) => setDocIds((prev) => (e.target.checked ? (prev.length >= PODCAST_LIMITS.maxDocs ? prev : [...prev, d.id]) : prev.filter((x) => x !== d.id)))}
                  />
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{d.filename}</span>
                </label>
              ))}
            </div>
          )}
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <Rss className="size-3.5" /> Articoli da un feed RSS
            </p>
            <div className="flex gap-2">
              <Input aria-label="Indirizzo del feed RSS" value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="https://esempio.it/feed.xml" />
              <Button type="button" variant="outline" onClick={() => void loadFeed()} disabled={feedLoading || !feedUrl.trim()}>
                {feedLoading ? <Loader2 className="animate-spin" /> : null} Cerca
              </Button>
            </div>
            {feedItems.length > 0 && (
              <div className="flex max-h-48 flex-col gap-1 overflow-auto rounded-md border p-2">
                {feedItems.map((i) => (
                  <label key={i.link} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50">
                    <input type="checkbox" className="mt-0.5 size-4 accent-[hsl(var(--primary))]" checked={articles.some((a) => a.url === i.link)} onChange={(e) => toggleArticle(i, e.target.checked)} />
                    <span className="min-w-0">
                      <span className="block font-medium">{i.title}</span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">{i.summary}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {articles.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {articles.length} {articles.length === 1 ? 'articolo scelto' : 'articoli scelti'} (massimo {PODCAST_LIMITS.maxArticles}).
              </p>
            )}
          </div>
        </div>

        {est?.billed && est.priced && (
          <p className="text-xs text-muted-foreground">
            Costo stimato di copione e audio: <strong>{fmt(est.total)} crediti</strong>. Aggiungere la puntata non costa: si paga quando scrivi il copione e quando registri l&apos;audio.
          </p>
        )}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Annulla
        </Button>
        <Button variant="outline" onClick={() => void submit(false)} disabled={!valid || busy}>
          Aggiungi
        </Button>
        <Button onClick={() => void submit(true)} disabled={!valid || busy}>
          {busy ? <Loader2 className="animate-spin" /> : null} Aggiungi e scrivi il copione
        </Button>
      </div>
    </Dialog>
  );
}
