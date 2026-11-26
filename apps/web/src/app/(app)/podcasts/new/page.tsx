'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ImageUp, Loader2, Mic } from 'lucide-react';
import { PODCAST_CATEGORIES, PODCAST_COVER, PODCAST_LIMITS, podcastVoiceKey, type PodcastCategory, type PodcastHost } from '@scorm/contracts';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { HostsEditor, nextVoice } from '@/components/podcasts/hosts-editor';
import { PODCAST_ENERGY, PODCAST_LANGUAGES, errText } from '@/components/podcasts/podcast-labels';
import { getApiClient } from '@/lib/api/client';
import { useCreatePodcast, useFolders, usePodcastVoices } from '@/lib/api/hooks';
import { flatOptions } from '@/components/courses/folder-dialog';

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

/** Legge le dimensioni di un'immagine nel browser, per avvisare subito se la copertina non va bene per i feed. */
function imageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      reject(new Error('Immagine non leggibile'));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export default function NewPodcastPage() {
  const router = useRouter();
  const toast = useToast();
  const create = useCreatePodcast();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [language, setLanguage] = React.useState('it');
  const [category, setCategory] = React.useState<PodcastCategory>('Education');
  const [folderId, setFolderId] = React.useState('');
  const folders = useFolders('PODCAST');
  // Cartella proposta: quella da cui si è partiti (?folder=…), letta nel browser.
  React.useEffect(() => {
    const f = new URLSearchParams(window.location.search).get('folder');
    if (f) setFolderId(f);
  }, []);
  const [author, setAuthor] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [explicit, setExplicit] = React.useState(false);
  const [cover, setCover] = React.useState<{ file: File; url: string; width: number; height: number } | null>(null);
  // Partecipanti: si parte con due voci; da uno (monologo) a quattro (tavola rotonda).
  const [hosts, setHosts] = React.useState<PodcastHost[]>([
    { key: 'A', name: '', voice: { kind: 'catalog', provider: 'polly', id: '' } },
    { key: 'B', name: '', voice: { kind: 'catalog', provider: 'polly', id: '' } },
  ]);
  const [topic, setTopic] = React.useState('');
  const [audience, setAudience] = React.useState('');
  const [tone, setTone] = React.useState('');
  const [minutes, setMinutes] = React.useState(8);
  const [energy, setEnergy] = React.useState<'relaxed' | 'lively' | 'wild'>('lively');
  const [saving, setSaving] = React.useState(false);

  const voices = usePodcastVoices(language);

  React.useEffect(() => () => { if (cover) URL.revokeObjectURL(cover.url); }, [cover]);

  // Voci di partenza: una per partecipante, diverse tra loro. Si riallineano se la lingua cambia.
  React.useEffect(() => {
    const list = voices.data ?? [];
    setHosts((cur) => {
      const out: PodcastHost[] = [];
      for (const h of cur) {
        const valid = list.some((v) => v.key === podcastVoiceKey(h.voice));
        const voice = valid ? h.voice : (nextVoice(list, out) ?? h.voice);
        const name = h.name || list.find((v) => v.key === podcastVoiceKey(voice))?.name || '';
        out.push({ ...h, voice, name: valid || !h.voice.id ? name : name });
      }
      return JSON.stringify(out) === JSON.stringify(cur) ? cur : out;
    });
  }, [voices.data]);
  async function pickCover(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) {
      toast.show('Usa un\u2019immagine JPEG o PNG', 'error');
      return;
    }
    if (file.size > PODCAST_COVER.maxBytes) {
      toast.show('Copertina troppo grande (massimo 10 MB)', 'error');
      return;
    }
    try {
      const size = await imageSize(file);
      setCover({ file, url: URL.createObjectURL(file), ...size });
    } catch (e) {
      toast.show(errText(e), 'error');
    }
  }

  const coverOk = cover && cover.width === cover.height && cover.width >= PODCAST_COVER.minPx && cover.width <= PODCAST_COVER.maxPx;

  const problems: string[] = [];
  if (!title.trim()) problems.push('Dai un titolo al podcast');
  if (hosts.some((h) => !h.name.trim())) problems.push('Scrivi il nome di ogni partecipante');
  if (hosts.some((h) => !h.voice.id)) problems.push('Scegli la voce di ogni partecipante');

  async function submit() {
    setSaving(true);
    try {
      const view = await create.mutateAsync({
        title: title.trim(),
        description: description.trim(),
        language,
        category,
        author: author.trim() || undefined,
        contactEmail: email.trim() || undefined,
        explicit,
        folderId: folderId || null,
        hosts: hosts.map((h) => ({ ...h, name: h.name.trim() })),
        brief: {
          topic: topic.trim(),
          audience: audience.trim() || undefined,
          tone: tone.trim() || undefined,
          objectives: [],
          episodeMinutes: minutes,
          energy,
        },
      });
      // La copertina si carica dopo la creazione: se non riesce, il podcast c'è e si può riprovare dalla sua pagina.
      if (cover) {
        try {
          await getApiClient().uploadPodcastCover(view.id, cover.file);
        } catch (e) {
          toast.show(`Podcast creato, ma la copertina non è stata caricata: ${errText(e)}`, 'error');
        }
      }
      router.push(`/podcasts/serie?id=${view.id}`);
    } catch (e) {
      toast.show(errText(e, 'Creazione non riuscita'), 'error');
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/podcasts">
          <ArrowLeft /> Podcast
        </Link>
      </Button>
      <PageHeader
        title="Nuovo podcast"
        description="Crei il contenitore: titolo, copertina, conduttori e linea editoriale. Le puntate le aggiungi dopo, una alla volta, quando vuoi."
      />

      <Section n={1} title="Il podcast">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pc-title">Titolo</Label>
            <Input id="pc-title" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} placeholder="Es. Allenare senza fare danni" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pc-desc">Descrizione</Label>
            <Textarea id="pc-desc" rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Di cosa parla il podcast e a chi si rivolge" />
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
            <Label htmlFor="pc-folder">Cartella</Label>
            <Select id="pc-folder" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">— Nessuna cartella —</option>
              {flatOptions(folders.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pc-author">Autore</Label>
            <Input id="pc-author" value={author} maxLength={100} onChange={(e) => setAuthor(e.target.value)} placeholder="Chi firma il podcast" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pc-email">Email di contatto</Label>
            <Input id="pc-email" type="email" value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={explicit} onChange={(e) => setExplicit(e.target.checked)} />
            Contenuto per adulti
          </label>
        </div>
      </Section>

      <Section n={2} title="Copertina" hint={`Facoltativa adesso. Per Spotify e Apple Podcasts serve quadrata, da ${PODCAST_COVER.minPx} a ${PODCAST_COVER.maxPx} px, JPEG o PNG.`}>
        <div className="flex flex-wrap items-center gap-4">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- anteprima locale
            <img src={cover.url} alt="Anteprima della copertina" className="size-24 rounded-md border object-cover" />
          ) : (
            <div className="grid size-24 place-items-center rounded-md border border-dashed text-xs text-muted-foreground">Nessuna</div>
          )}
          <div className="space-y-1.5">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => { void pickCover(e.target.files?.[0]); e.target.value = ''; }} />
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
              <ImageUp /> {cover ? 'Cambia immagine' : 'Scegli un\u2019immagine'}
            </Button>
            {cover && (
              <p className={coverOk ? 'text-xs text-muted-foreground' : 'text-xs text-amber-800'}>
                {cover.width}×{cover.height} px{coverOk ? ': va bene.' : `: non rispetta le misure per Apple Podcasts (quadrata, da ${PODCAST_COVER.minPx} a ${PODCAST_COVER.maxPx} px). Puoi cambiarla dopo.`}
              </p>
            )}
          </div>
        </div>
      </Section>

      <Section n={3} title="Partecipanti" hint="Da uno a quattro. Con più partecipanti la puntata è una discussione: dai a ciascuno un carattere e una voce. Puoi ascoltare l'anteprima delle voci.">
        <HostsEditor hosts={hosts} voices={voices.data ?? []} language={language} onChange={setHosts} />
        {voices.isSuccess && (voices.data?.length ?? 0) === 0 && (
          <p className="text-sm text-destructive">Per questa lingua non ci sono ancora voci disponibili. Scegli un&apos;altra lingua.</p>
        )}
      </Section>

      <Section n={4} title="Linea editoriale" hint="Facoltativa: guida l'AI in tutte le puntate. Ogni puntata avrà poi il suo argomento e le sue fonti.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pc-topic">Tema generale</Label>
            <Textarea id="pc-topic" rows={2} maxLength={500} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Il filo che lega tutte le puntate" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pc-aud">Pubblico</Label>
            <Input id="pc-aud" value={audience} maxLength={300} onChange={(e) => setAudience(e.target.value)} placeholder="Es. allenatori delle giovanili" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pc-tone">Tono</Label>
            <Input id="pc-tone" value={tone} maxLength={200} onChange={(e) => setTone(e.target.value)} placeholder="Es. amichevole e concreto" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pc-energy">Ritmo e stile della conversazione</Label>
            <Select id="pc-energy" value={energy} onChange={(e) => setEnergy(e.target.value as 'relaxed' | 'lively' | 'wild')}>
              {PODCAST_ENERGY.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">{PODCAST_ENERGY.find((o) => o.value === energy)?.hint} Conta con almeno due partecipanti.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pc-min">Durata di una puntata (minuti)</Label>
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

      <Card>
        <CardContent className="space-y-3 p-5">
          <p className="text-sm text-muted-foreground">Creare il podcast non costa nulla: i crediti si usano quando scrivi un copione o registri un&apos;audio.</p>
          {problems.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-900">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <Button type="button" size="lg" disabled={problems.length > 0 || saving} onClick={() => void submit()}>
            {saving ? <Loader2 className="animate-spin" /> : <Mic />}
            {saving ? 'Creo…' : 'Crea il podcast'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
