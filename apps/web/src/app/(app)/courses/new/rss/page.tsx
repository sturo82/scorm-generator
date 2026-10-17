'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Loader2, Info, Sparkles, ChevronDown, Globe, Rss } from 'lucide-react';
import { FEED_CATEGORIES, FEED_CATEGORY_LABEL, type FeedCategory } from '@scorm/contracts';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import {
  useCreateCourseFromRss,
  useTenantFeeds,
  useAddTenantFeed,
  useRemoveTenantFeed,
} from '@/lib/api/hooks';

const LANGUAGES = [
  { value: 'it', label: 'Italiano' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
];

type Source = 'everywhere' | 'mine';

/**
 * Crea un corso da un ARGOMENTO. UX-first: l'utente scrive solo di cosa parla il
 * corso; il sistema cerca OVUNQUE (Google News, testate selezionate, Wikipedia),
 * sceglie i contenuti migliori senza doppioni, li importa come knowledge e
 * precompila il brief. Le opzioni (sorgente, area, numero, feed propri) sono in
 * un pannello avanzato collassato: chi non lo apre ha già un ottimo risultato.
 */
export default function NewCourseFromRssPage() {
  const router = useRouter();
  const toast = useToast();
  const create = useCreateCourseFromRss();
  const feeds = useTenantFeeds();
  const addFeed = useAddTenantFeed();
  const removeFeed = useRemoveTenantFeed();

  const [topic, setTopic] = React.useState('');
  const [advanced, setAdvanced] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [language, setLanguage] = React.useState('it');
  const [source, setSource] = React.useState<Source>('everywhere');
  const [category, setCategory] = React.useState<FeedCategory | ''>('');
  const [maxArticles, setMaxArticles] = React.useState(12);
  const [newFeedUrl, setNewFeedUrl] = React.useState('');

  const myFeeds = feeds.data ?? [];
  const canSubmit = topic.trim().length >= 2 && !create.isPending;
  const mineButEmpty = source === 'mine' && myFeeds.length === 0;

  async function handleAddFeed() {
    const url = newFeedUrl.trim();
    if (!url) return;
    try {
      await addFeed.mutateAsync({ url });
      setNewFeedUrl('');
      toast.show('Feed salvato', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message.replace(/^API \d+:\s*/, '') : '';
      toast.show(msg || 'Feed non valido', 'error');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    if (mineButEmpty) {
      toast.show('Non hai feed salvati: aggiungine o scegli «Ovunque»', 'error');
      return;
    }
    try {
      const res = await create.mutateAsync({
        topic: topic.trim(),
        title: title.trim() || undefined,
        language,
        source,
        category: source === 'mine' ? undefined : category || undefined,
        maxArticles,
      });
      toast.show(
        `Corso creato: ${res.importedCount} contenuti selezionati` +
          (res.briefDrafted ? ', brief precompilato' : ''),
        'success',
      );
      router.push(`/courses/${res.courseId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message.replace(/^API \d+:\s*/, '') : '';
      toast.show(msg || 'Creazione non riuscita', 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Crea corso da un argomento"
        description="Scrivi di cosa parla il corso: cerchiamo le fonti migliori, scartiamo i doppioni e prepariamo il corso con il brief già compilato."
      />

      <div className="mx-auto max-w-2xl">
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              {/* Argomento — il protagonista */}
              <div className="space-y-2">
                <Label htmlFor="rss-topic" className="text-base">
                  Di cosa parla il corso?
                </Label>
                <Input
                  id="rss-topic"
                  value={topic}
                  maxLength={300}
                  autoFocus
                  className="h-12 text-base"
                  placeholder="Es. regolamentazione dell'intelligenza artificiale in Europa"
                  onChange={(e) => setTopic(e.target.value)}
                />
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Globe className="size-3.5" aria-hidden />
                  Cerchiamo su Google News, testate autorevoli, Wikipedia e materiali didattici
                  aperti (Wikiversity, arXiv, MIT OpenCourseWare, OpenStax), in italiano e inglese.
                </p>
              </div>

              {/* Azione principale */}
              <div className="flex items-center gap-3">
                <Button type="submit" size="lg" disabled={!canSubmit || mineButEmpty}>
                  {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {create.isPending ? 'Ricerca e creazione…' : 'Crea corso'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => router.back()}>
                  Annulla
                </Button>
              </div>

              {create.isPending && (
                <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  Sto cercando le fonti migliori, scartando i doppioni e raccogliendo i contenuti.
                  Può richiedere qualche istante.
                </div>
              )}

              {/* Opzioni avanzate — collassate di default */}
              <div className="border-t pt-2">
                <button
                  type="button"
                  onClick={() => setAdvanced((v) => !v)}
                  aria-expanded={advanced}
                  className="flex w-full items-center justify-between py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Opzioni avanzate
                  <ChevronDown className={cn('size-4 transition-transform', advanced && 'rotate-180')} />
                </button>

                {advanced && (
                  <div className="space-y-5 pt-3">
                    {/* Titolo */}
                    <div className="space-y-1.5">
                      <Label htmlFor="rss-title">Titolo del corso</Label>
                      <Input
                        id="rss-title"
                        value={title}
                        maxLength={200}
                        placeholder="Lascia vuoto per usare l'argomento"
                        onChange={(e) => setTitle(e.target.value)}
                      />
                    </div>

                    {/* Sorgente */}
                    <div className="space-y-1.5">
                      <Label>Dove cercare</Label>
                      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Sorgente">
                        {([
                          ['everywhere', 'Ovunque (consigliato)'],
                          ['mine', 'Solo i miei feed'],
                        ] as Array<[Source, string]>).map(([val, label]) => (
                          <button
                            key={val}
                            type="button"
                            role="radio"
                            aria-checked={source === val}
                            onClick={() => setSource(val)}
                            className={cn(
                              'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                              source === val
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-input text-muted-foreground hover:bg-accent/60',
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {mineButEmpty && (
                        <p className="text-xs text-destructive">
                          Non hai feed salvati: aggiungine sotto o scegli «Ovunque».
                        </p>
                      )}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      {/* Lingua */}
                      <div className="space-y-1.5">
                        <Label htmlFor="rss-lang">Lingua del corso</Label>
                        <Select id="rss-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
                          {LANGUAGES.map((l) => (
                            <option key={l.value} value={l.value}>
                              {l.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                      {/* Numero articoli */}
                      <div className="space-y-1.5">
                        <Label htmlFor="rss-count">Contenuti nel corso</Label>
                        <Input
                          id="rss-count"
                          type="number"
                          min={1}
                          max={25}
                          value={maxArticles}
                          onChange={(e) => setMaxArticles(Math.max(1, Math.min(25, Number(e.target.value) || 1)))}
                        />
                      </div>
                    </div>

                    {/* Area tematica (solo "ovunque") */}
                    {source === 'everywhere' && (
                      <div className="space-y-1.5">
                        <Label htmlFor="rss-cat">Restringi a un&apos;area (opzionale)</Label>
                        <Select
                          id="rss-cat"
                          value={category}
                          onChange={(e) => setCategory(e.target.value as FeedCategory | '')}
                        >
                          <option value="">Tutte le aree</option>
                          {FEED_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {FEED_CATEGORY_LABEL[c]}
                            </option>
                          ))}
                        </Select>
                      </div>
                    )}

                    {/* I miei feed */}
                    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                      <div className="flex items-center gap-2">
                        <Rss className="size-4 text-muted-foreground" aria-hidden />
                        <span className="text-sm font-medium">I tuoi feed RSS</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Feed salvati, riutilizzabili. Inclusi sempre con «Ovunque», esclusivi con
                        «Solo i miei feed».
                      </p>
                      <div className="flex items-center gap-2">
                        <Input
                          value={newFeedUrl}
                          type="url"
                          placeholder="https://esempio.com/feed.xml"
                          onChange={(e) => setNewFeedUrl(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleAddFeed();
                            }
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label="Aggiungi feed"
                          disabled={addFeed.isPending || !newFeedUrl.trim()}
                          onClick={() => void handleAddFeed()}
                        >
                          {addFeed.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                        </Button>
                      </div>
                      {myFeeds.length > 0 && (
                        <ul className="space-y-1.5 pt-1">
                          {myFeeds.map((f) => (
                            <li key={f.id} className="flex items-center gap-2 rounded-md border bg-card p-2">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium" title={f.name}>
                                  {f.name}
                                </p>
                                <p className="truncate text-xs text-muted-foreground" title={f.url}>
                                  {f.url}
                                </p>
                              </div>
                              <button
                                type="button"
                                aria-label={`Rimuovi ${f.name}`}
                                className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                onClick={async () => {
                                  try {
                                    await removeFeed.mutateAsync(f.id);
                                    toast.show('Feed rimosso', 'success');
                                  } catch {
                                    toast.show('Rimozione non riuscita', 'error');
                                  }
                                }}
                              >
                                <Trash2 className="size-4" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
