'use client';
import * as React from 'react';
import { ArrowLeft, Copy, Globe, Lock, Mic, Plus, Rss, Settings2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { podcastVoiceKey, type PodcastView } from '@scorm/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { PODCAST_LANGUAGES, fmtDuration } from './podcast-labels';

/** Testata del podcast: copertina, descrizione, conduttori, numeri e azioni principali. */
export function PodcastHero({
  podcast: p,
  busy,
  canAdd,
  onNewEpisode,
  onSettings,
  onDelete,
  onOpenFeed,
}: {
  podcast: PodcastView;
  busy: boolean;
  canAdd: boolean;
  onNewEpisode: () => void;
  onSettings: () => void;
  onDelete: () => void;
  onOpenFeed: () => void;
}) {
  const toast = useToast();
  const lang = PODCAST_LANGUAGES.find((l) => l.code === p.language.slice(0, 2))?.label ?? p.language;
  const published = p.episodes.filter((e) => e.published).length;
  const totalSec = p.episodes.reduce((n, e) => n + (e.durationSec ?? 0), 0);
  const withAudio = p.episodes.filter((e) => e.hasAudio).length;
  const description = p.description.trim() || p.brief.topic;
  const publicFeed = p.visibility === 'PUBLIC';

  async function copyFeed() {
    if (!p.feedUrl) return;
    try {
      await navigator.clipboard.writeText(p.feedUrl);
      toast.show('Indirizzo del feed copiato', 'success');
    } catch {
      toast.show('Non riesco a copiare: apri la scheda Feed RSS', 'error');
    }
  }

  return (
    <header className="overflow-hidden rounded-2xl border bg-card shadow-card">
      <div className="relative">
        {/* Sfondo: la copertina sfocata (o un gradiente) dà il colore alla testata. */}
        {p.cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL firmato dinamico
          <img src={p.cover.url} alt="" aria-hidden className="absolute inset-0 size-full scale-125 object-cover opacity-30 blur-2xl" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-primary/10 to-muted" aria-hidden />
        )}
        <div className="relative space-y-5 p-5 sm:p-7">
          <div className="flex items-center justify-between">
            <Button asChild variant="ghost" size="sm" className="-ml-2 bg-background/60 backdrop-blur">
              <Link href="/podcasts">
                <ArrowLeft /> Podcast
              </Link>
            </Button>
            <Button variant="ghost" size="sm" className="bg-background/60 text-muted-foreground backdrop-blur hover:text-destructive" onClick={onDelete} disabled={busy}>
              <Trash2 /> Elimina
            </Button>
          </div>
          <div className="flex flex-col gap-6 sm:flex-row">
            <div className="size-40 shrink-0 overflow-hidden rounded-xl border bg-background shadow-lg sm:size-52">
              {p.cover ? (
                // eslint-disable-next-line @next/next/no-img-element -- URL firmato dinamico
                <img src={p.cover.url} alt={`Copertina: ${p.title}`} className="size-full object-cover" />
              ) : (
                <div className="grid size-full place-items-center bg-gradient-to-br from-primary/30 to-primary/10">
                  <Mic className="size-12 text-primary/70" aria-hidden />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="bg-background/70">{p.category}</Badge>
                <Badge variant="outline" className="bg-background/70">{lang}</Badge>
                <Badge variant={publicFeed ? 'success' : 'secondary'} className="gap-1">
                  {publicFeed ? <Globe className="size-3" aria-hidden /> : <Lock className="size-3" aria-hidden />}
                  {publicFeed ? 'Feed pubblico' : 'Feed privato'}
                </Badge>
                {p.explicit && <Badge variant="warning">Esplicito</Badge>}
              </div>
              <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{p.title}</h1>
              {description ? (
                <p className="max-w-2xl whitespace-pre-line text-sm text-muted-foreground sm:text-base">{description}</p>
              ) : (
                <button type="button" onClick={onSettings} className="text-sm italic text-muted-foreground underline-offset-2 hover:underline">
                  Aggiungi una descrizione
                </button>
              )}
              <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Conduttori</dt>
                  <dd className="font-medium">{p.hosts.map((h) => h.name).join(' e ')}</dd>
                </div>
                {p.author && (
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground">Autore</dt>
                    <dd className="font-medium">{p.author}</dd>
                  </div>
                )}
                {p.brief.audience && (
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground">Pubblico</dt>
                    <dd className="font-medium">{p.brief.audience}</dd>
                  </div>
                )}
                {p.brief.tone && (
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground">Tono</dt>
                    <dd className="font-medium">{p.brief.tone}</dd>
                  </div>
                )}
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Voci</dt>
                  <dd className="font-medium">
                    {Array.from(new Set(p.hosts.map((h) => (podcastVoiceKey(h.voice).startsWith('heygen') ? 'HeyGen' : 'Amazon Polly')))).join(' + ')}
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button onClick={onNewEpisode} disabled={busy || !canAdd}>
                  <Plus /> Nuova puntata
                </Button>
                {p.publishingEnabled && p.feedUrl ? (
                  <Button variant="outline" className="bg-background/70" onClick={() => void copyFeed()}>
                    <Copy /> Copia feed RSS
                  </Button>
                ) : null}
                <Button variant="outline" className="bg-background/70" onClick={onOpenFeed}>
                  <Rss /> Feed e pubblicazione
                </Button>
                <Button variant="outline" className="bg-background/70" onClick={onSettings}>
                  <Settings2 /> Impostazioni
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <dl className="grid grid-cols-2 divide-x border-t bg-card sm:grid-cols-4">
        <Stat label={p.episodes.length === 1 ? 'Puntata' : 'Puntate'} value={String(p.episodes.length)} />
        <Stat label="Pubblicate" value={`${published}`} hint={published === 0 && withAudio > 0 ? `${withAudio} pronte da pubblicare` : undefined} />
        <Stat label="Con audio" value={String(withAudio)} />
        <Stat label="Durata totale" value={totalSec > 0 ? fmtDuration(totalSec) : '–'} />
      </dl>
    </header>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="px-5 py-3 text-center">
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      {hint && <p className="text-[11px] text-amber-700">{hint}</p>}
    </div>
  );
}
