'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Loader2, Info, Sparkles, ChevronDown, Globe, Rss, Eye } from 'lucide-react';
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
  useRssPreview,
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
  const preview = useRssPreview();
  const feeds = useTenantFeeds();
  const addFeed = useAddTenantFeed();
  const removeFeed = useRemoveTenantFeed();

  const [topic, setTopic] = React.useState('');
  const [advanced, setAdvanced] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [audience, setAudience] = React.useState('');
  const [tone, setTone] = React.useState('');
  const [language, setLanguage] = React.useState('it');
  const [source, setSource] = React.useState<Source>('everywhere');
  const [category, setCategory] = React.useState<FeedCategory | ''>('');
  const [maxArticles, setMaxArticles] = React.useState(12);
  const [newFeedUrl, setNewFeedUrl] = React.useState('');

  const myFeeds = feeds.data ?? [];
  const busy = create.isPending || preview.isPending;
  const canSubmit = topic.trim().length >= 2 && !busy;
  const mineButEmpty = source === 'mine' && myFeeds.length === 0;
  const previewData = preview.data;

  async function handlePreview() {
    if (topic.trim().length < 2 || busy) return;
    if (mineButEmpty) {
      toast.show('Non hai feed salvati: aggiungine o scegli «Ovunque»', 'error');
      return;
    }
    try {
      const res = await preview.mutateAsync({
        topic: topic.trim(),
        language,
        source,
        category: source === 'mine' ? undefined : category || undefined,
        audience: audience.trim() || undefined,
        tone: tone.trim() || undefined,
      });
      // Propone il titolo se l'utente non ne ha scritto uno.
      if (!title.trim() && res.proposedTitle) setTitle(res.proposedTitle);
      // Riproponi target e tono proposti dall'LLM se l'utente non li ha indicati:
      // diventano visibili e modificabili per rigenerare un'anteprima coerente.
      if (!audience.trim() && res.proposedAudience) setAudience(res.proposedAudience);
      if (!tone.trim() && res.proposedTone) setTone(res.proposedTone);
    } catch (err) {
      const msg = err instanceof Error ? err.message.replace(/^API \d+:\s*/, '') : '';
      toast.show(msg || 'Anteprima non riuscita', 'error');
    }
  }

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
        audience: audience.trim() || undefined,
        tone: tone.trim() || undefined,
        // Anteprima congelata: se l'autore l'ha generata, il corso nasce da
        // QUELLA (coerenza con ciò che ha visto), non da una nuova sintesi.
        preview: previewData ?? undefined,
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
                  onChange={(e) => {
                    setTopic(e.target.value);
                    // L'anteprima vale per l'argomento con cui è stata generata:
                    // se cambi argomento, la invalidiamo (va rigenerata) così
                    // "Crea corso" non congela un pre-sommario ormai incoerente.
                    if (previewData) preview.reset();
                  }}
                />
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Globe className="size-3.5" aria-hidden />
                  Cerchiamo su Google News, testate autorevoli, Wikipedia e materiali didattici
                  aperti (Wikiversity, arXiv, MIT OpenCourseWare, OpenStax), in italiano e inglese.
                </p>
              </div>

              {/* Target e tono — opzionali: se vuoti, li propone l'anteprima */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rss-audience">
                    A chi è rivolto? <span className="font-normal text-muted-foreground">(opzionale)</span>
                  </Label>
                  <Input
                    id="rss-audience"
                    value={audience}
                    maxLength={300}
                    placeholder="Es. neoassunti senza basi tecniche"
                    onChange={(e) => setAudience(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rss-tone">
                    Tono di voce <span className="font-normal text-muted-foreground">(opzionale)</span>
                  </Label>
                  <Input
                    id="rss-tone"
                    value={tone}
                    maxLength={200}
                    placeholder="Es. professionale ma accessibile"
                    onChange={(e) => setTone(e.target.value)}
                  />
                </div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground sm:col-span-2">
                  <Info className="size-3.5 shrink-0" aria-hidden />
                  Se li lasci vuoti te li proponiamo noi nell&apos;anteprima: potrai modificarli e rigenerarla.
                </p>
              </div>

              {/* Azioni: Anteprima (pre-sommario) + Crea */}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  disabled={!canSubmit || mineButEmpty}
                  onClick={() => void handlePreview()}
                >
                  {preview.isPending ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
                  {preview.isPending ? 'Anteprima…' : previewData ? 'Rigenera anteprima' : 'Anteprima'}
                </Button>
                <Button type="submit" size="lg" disabled={!canSubmit || mineButEmpty}>
                  {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {create.isPending ? 'Ricerca e creazione…' : 'Crea corso'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => router.back()}>
                  Annulla
                </Button>
              </div>

              {/* Pre-sommario (anteprima): cosa conterrà il corso */}
              {previewData && (
                <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary">Anteprima del corso</p>
                    <p className="mt-1 text-base font-semibold">{previewData.proposedTitle}</p>
                    {previewData.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{previewData.description}</p>
                    )}
                    {(previewData.proposedAudience || previewData.proposedTone) && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {previewData.proposedAudience && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary">
                            Target: {previewData.proposedAudience}
                          </span>
                        )}
                        {previewData.proposedTone && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary">
                            Tono: {previewData.proposedTone}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {previewData.keyConcepts.length > 0 && (
                    <div>
                      <p className="mb-1 text-sm font-medium">Concetti chiave</p>
                      <ul className="list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
                        {previewData.keyConcepts.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {previewData.suggestedLessons.length > 0 && (
                    <div>
                      <p className="mb-1 text-sm font-medium">Lezioni suggerite</p>
                      <ol className="list-inside list-decimal space-y-0.5 text-sm text-muted-foreground">
                        {previewData.suggestedLessons.map((l, i) => (
                          <li key={i}>{l}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {previewData.sources.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Fonti trovate: {previewData.sources.join(', ')} · {previewData.examined} contenuti esaminati
                    </p>
                  )}
                  <p className="text-xs italic text-muted-foreground">
                    Anteprima indicativa: la generazione finale può rifinire struttura e contenuti.
                    Premi «Crea corso» per procedere.
                  </p>
                </div>
              )}

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
