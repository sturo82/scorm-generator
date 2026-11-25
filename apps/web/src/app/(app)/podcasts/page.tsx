'use client';
import Link from 'next/link';
import { Mic, Plus } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePodcasts } from '@/lib/api/hooks';
import { PODCAST_LANGUAGES } from '@/components/podcasts/podcast-labels';

export default function PodcastsPage() {
  const podcasts = usePodcasts();
  const list = podcasts.data ?? [];

  return (
    <div>
      <PageHeader
        title="Podcast"
        description="Serie di puntate audio con due conduttori, scritte dall'AI dalle tue fonti."
        actions={
          <Button asChild>
            <Link href="/podcasts/new">
              <Plus /> Nuovo podcast
            </Link>
          </Button>
        }
      />
      {podcasts.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : podcasts.isError ? (
        <p className="text-sm text-destructive">Non riesco a leggere i podcast. Riprova tra poco.</p>
      ) : list.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Mic className="size-8 text-muted-foreground" aria-hidden />
            <p className="font-medium">Non hai ancora nessun podcast</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Scegli un tema (o documenti e articoli come fonte), i due conduttori e quante puntate vuoi: il resto lo fa il sistema.
            </p>
            <Button asChild>
              <Link href="/podcasts/new">
                <Plus /> Crea il primo podcast
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p) => (
            <Link key={p.id} href={`/podcasts/serie?id=${p.id}`} className="group">
              <Card className="h-full transition-shadow group-hover:shadow-elevate">
                <CardContent className="space-y-2 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold leading-snug">{p.title}</h2>
                    <Mic className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {PODCAST_LANGUAGES.find((l) => l.code === p.language.slice(0, 2))?.label ?? p.language} · {p.episodeCount}{' '}
                    {p.episodeCount === 1 ? 'puntata' : 'puntate'}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">{p.readyCount}</span> con audio · <span className="font-medium">{p.publishedCount}</span> pubblicate
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
