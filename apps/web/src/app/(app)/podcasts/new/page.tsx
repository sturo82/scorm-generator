'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileText, Loader2, Rss, Wand2 } from 'lucide-react';
import { PODCAST_CATEGORIES, PODCAST_LIMITS, type PodcastArticleRef, type PodcastCategory } from '@scorm/contracts';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { VoiceSelect } from '@/components/podcasts/voice-select';
import { PODCAST_LANGUAGES, errText } from '@/components/podcasts/podcast-labels';
import { getApiClient } from '@/lib/api/client';
import { useCreatePodcast, useKnowledge, usePodcastEstimateNew, usePodcastVoices } from '@/lib/api/hooks';

const fmt = (n: number) => n.toLocaleString('it-IT');

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <span className="grid size-6 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">{n}</span>
            {title}
          </h2>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export default function NewPodcastPage() {
  const router = useRouter();
  const toast = useToast();
  const create = useCreatePodcast();
  const knowledge = useKnowledge('GLOBAL');

  const [title, setTitle] = React.useState('');
  const [topic, setTopic] = React.useState('');
  const [audience, setAudience] = React.useState('');
  const [tone, setTone] = React.useState('');
  const [language, setLanguage] = React.useState('it');
  const [episodeCount, setEpisodeCount] = React.useState(4);
  const [minutes, setMinutes] = React.useState(8);
  const [docIds, setDocIds] = React.useState<string[]>([]);
  const [feedUrl, setFeedUrl] = React.useState('');
  const [feedLoading, setFeedLoading] = React.useState(false);
  const [feedItems, setFeedItems] = React.useState<Array<{ title: string; link?: string; summary: string }>>([]);
  const [articles, setArticles] = React.useState<PodcastArticleRef[]>([]);
  const [nameA, setNameA] = React.useState('');
  const [nameB, setNameB] = React.useState('');
  const [voiceA, setVoiceA] = React.useState('');
  const [voiceB, setVoiceB] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [category, setCategory] = React.useState<PodcastCategory>('Education');
  const [author, setAuthor] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [explicit, setExplicit] = React.useState(false);

  const voices = usePodcastVoices(language);
  const estimate = usePodcastEstimateNew(episodeCount, minutes);
  const readyDocs = React.useMemo(() => (knowledge.data ?? []).filter((d) => d.status === 'READY'), [knowledge.data]);

  // Voci di partenza: una donna e un uomo, se ci sono. Si riallineano se la lingua cambia.
  React.useEffect(() => {
    const list = voices.data ?? [];
    if (list.length === 0) {
      setVoiceA('');
      setVoiceB('');
      return;
    }
    const female = list.find((v) => v.gender === 'female') ?? list[0]!;
    const male = list.find((v) => v.gender === 'male') ?? list.find((v) => v.id !== female.id) ?? list[0]!;
    if (!list.some((v) => v.id === voiceA)) setVoiceA(female.id);
    if (!list.some((v) => v.id === voiceB)) setVoiceB(male.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voices.data]);

  React.useEffect(() => {
    const list = voices.data ?? [];
    if (!nameA) setNameA(list.find((v) => v.id === voiceA)?.name ?? '');
    if (!nameB) setNameB(list.find((v) => v.id === voiceB)?.name ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceA, voiceB, voices.data]);

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

  const problems: string[] = [];
  if (!title.trim()) problems.push('Dai un titolo al podcast');
  if (topic.trim().length < 3) problems.push('Descrivi il tema');
  if (!nameA.trim() || !nameB.trim()) problems.push('Scrivi il nome dei due conduttori');
  if (!voiceA || !voiceB) problems.push('Scegli la voce dei due conduttori');

  async function submit() {
    try {
      const view = await create.mutateAsync({
        title: title.trim(),
        description: description.trim(),
        language,
        category,
        author: author.trim() || undefined,
        contactEmail: email.trim() || undefined,
        explicit,
        hosts: [
          { key: 'A', name: nameA.trim(), voice: { kind: 'catalog', id: voiceA } },
          { key: 'B', name: nameB.trim(), voice: { kind: 'catalog', id: voiceB } },
        ],
        brief: { topic: topic.trim(), audience: audience.trim() || undefined, tone: tone.trim() || undefined, objectives: [] },
        knowledgeDocIds: docIds,
        articles,
        episodeCount,
        episodeMinutes: minutes,
      });
      router.push(`/podcasts/serie?id=${view.id}`);
    } catch (e) {
      toast.show(errText(e, 'Creazione non riuscita'), 'error');
    }
  }

  const est = estimate.data;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/podcasts">
          <ArrowLeft /> Podcast
        </Link>
      </Button>
      <PageHeader title="Nuovo podcast" description="Pochi dati: il sistema pianifica le puntate, scrive i copioni e registra le voci." />

      <Section n={1} title="Di cosa parla">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pc-title">Titolo del podcast</Label>
            <Input id="pc-title" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} placeholder="Es. Allenare senza fare danni" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pc-topic">Tema</Label>
            <Textarea id="pc-topic" rows={3} maxLength={500} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Cosa vuoi raccontare e a chi serve" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pc-aud">Pubblico (facoltativo)</Label>
            <Input id="pc-aud" value={audience} maxLength={300} onChange={(e) => setAudience(e.target.value)} placeholder="Es. allenatori delle giovanili" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pc-tone">Tono (facoltativo)</Label>
            <Input id="pc-tone" value={tone} maxLength={200} onChange={(e) => setTone(e.target.value)} placeholder="Es. amichevole e concreto" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pc-lang">Lingua</Label>
            <Select id="pc-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {PODCAST_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Section>

      <Section n={2} title="Fonti" hint="Facoltative. Con documenti o articoli le puntate si basano su quelli e non inventano oltre.">
        {readyDocs.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Documenti della knowledge</p>
            <div className="flex max-h-40 flex-col gap-1 overflow-auto rounded-lg border p-2">
              {readyDocs.map((d) => (
                <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent/50">
                  <input
                    type="checkbox"
                    className="size-4 accent-[hsl(var(--primary))]"
                    checked={docIds.includes(d.id)}
                    onChange={(e) =>
                      setDocIds((prev) => (e.target.checked ? (prev.length >= PODCAST_LIMITS.maxDocs ? prev : [...prev, d.id]) : prev.filter((x) => x !== d.id)))
                    }
                  />
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{d.filename}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Rss className="size-4" /> Articoli da un feed RSS
          </p>
          <div className="flex gap-2">
            <Input aria-label="Indirizzo del feed RSS" value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="https://esempio.it/feed.xml" />
            <Button type="button" variant="outline" onClick={() => void loadFeed()} disabled={feedLoading || !feedUrl.trim()}>
              {feedLoading ? <Loader2 className="animate-spin" /> : null} Cerca
            </Button>
          </div>
          {feedItems.length > 0 && (
            <div className="flex max-h-56 flex-col gap-1 overflow-auto rounded-lg border p-2">
              {feedItems.map((i) => (
                <label key={i.link} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
                    checked={articles.some((a) => a.url === i.link)}
                    onChange={(e) => toggleArticle(i, e.target.checked)}
                  />
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
      </Section>

      <Section n={3} title="Puntate">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pc-count">Numero di puntate</Label>
            <Input
              id="pc-count"
              type="number"
              min={1}
              max={PODCAST_LIMITS.maxEpisodes}
              value={episodeCount}
              onChange={(e) => setEpisodeCount(Math.min(PODCAST_LIMITS.maxEpisodes, Math.max(1, Math.round(Number(e.target.value) || 1))))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pc-min">Minuti per puntata</Label>
            <Input
              id="pc-min"
              type="number"
              min={PODCAST_LIMITS.minMinutes}
              max={PODCAST_LIMITS.maxMinutes}
              value={minutes}
              onChange={(e) => setMinutes(Math.min(PODCAST_LIMITS.maxMinutes, Math.max(PODCAST_LIMITS.minMinutes, Math.round(Number(e.target.value) || PODCAST_LIMITS.minMinutes))))}
            />
          </div>
        </div>
      </Section>

      <Section n={4} title="Conduttori" hint="Due voci che dialogano. Puoi ascoltarne l'anteprima prima di sceglierle.">
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              { key: 'A', name: nameA, setName: setNameA, voice: voiceA, setVoice: setVoiceA },
              { key: 'B', name: nameB, setName: setNameB, voice: voiceB, setVoice: setVoiceB },
            ] as const
          ).map((h) => (
            <div key={h.key} className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">Conduttore {h.key === 'A' ? 'principale' : 'ospite'}</p>
              <Input aria-label={`Nome del conduttore ${h.key}`} value={h.name} maxLength={40} onChange={(e) => h.setName(e.target.value)} placeholder="Nome" />
              <VoiceSelect voices={voices.data ?? []} value={h.voice} language={language} label={`Voce del conduttore ${h.key}`} onChange={h.setVoice} />
            </div>
          ))}
        </div>
        {voices.isSuccess && (voices.data?.length ?? 0) === 0 && (
          <p className="text-sm text-destructive">Per questa lingua non ci sono ancora voci disponibili. Scegli un&apos;altra lingua.</p>
        )}
      </Section>

      <Section n={5} title="Dati del feed" hint="Servono per pubblicare su Spotify, Apple Podcasts o altre piattaforme. Puoi completarli anche dopo.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pc-desc">Descrizione</Label>
            <Textarea id="pc-desc" rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pc-cat">Categoria</Label>
            <Select id="pc-cat" value={category} onChange={(e) => setCategory(e.target.value as PodcastCategory)}>
              {PODCAST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pc-author">Autore</Label>
            <Input id="pc-author" value={author} maxLength={100} onChange={(e) => setAuthor(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pc-email">Email di contatto</Label>
            <Input id="pc-email" type="email" value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={explicit} onChange={(e) => setExplicit(e.target.checked)} />
            Contenuto per adulti
          </label>
        </div>
      </Section>

      <Card>
        <CardContent className="space-y-3 p-5">
          {est?.billed && (
            <p className="text-sm">
              {est.priced ? (
                <>
                  Costo stimato fino alla fine: <strong>{fmt(est.total)} crediti</strong> ({episodeCount} {episodeCount === 1 ? 'puntata' : 'puntate'} da {minutes} min: piano,
                  copioni e audio). Ora parte solo il piano; copioni e audio si avviano dopo, con il loro costo.
                </>
              ) : (
                <span className="text-muted-foreground">Il prezzo di alcune voci non è ancora disponibile.</span>
              )}
            </p>
          )}
          {problems.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-900">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <Button type="button" size="lg" disabled={problems.length > 0 || create.isPending} onClick={() => void submit()}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
            {create.isPending ? 'Creo…' : 'Crea il podcast e pianifica le puntate'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
