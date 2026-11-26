'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ImageUp, Loader2, Mic } from 'lucide-react';
import { PODCAST_CATEGORIES, PODCAST_COVER, PODCAST_LIMITS, type PodcastCategory } from '@scorm/contracts';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { VoiceSelect } from '@/components/podcasts/voice-select';
import { PODCAST_LANGUAGES, errText } from '@/components/podcasts/podcast-labels';
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
  const [nameA, setNameA] = React.useState('');
  const [nameB, setNameB] = React.useState('');
  const [voiceA, setVoiceA] = React.useState('');
  const [voiceB, setVoiceB] = React.useState('');
  const [topic, setTopic] = React.useState('');
  const [audience, setAudience] = React.useState('');
  const [tone, setTone] = React.useState('');
  const [minutes, setMinutes] = React.useState(8);
  const [saving, setSaving] = React.useState(false);

  const voices = usePodcastVoices(language);

  React.useEffect(() => () => { if (cover) URL.revokeObjectURL(cover.url); }, [cover]);

  // Voci di partenza: una donna e un uomo, se ci sono. Si riallineano se la lingua cambia.
  React.useEffect(() => {
    const list = voices.data ?? [];
    if (list.length === 0) {
      setVoiceA('');
      setVoiceB('');
      return;
    }
    // Di partenza le voci Polly (le migliori per l'italiano nel catalogo); le altre si scelgono a mano.
    const base = list.some((v) => v.provider === 'polly') ? list.filter((v) => v.provider === 'polly') : list;
    const female = base.find((v) => v.gender === 'female') ?? base[0]!;
    const male = base.find((v) => v.gender === 'male') ?? base.find((v) => v.key !== female.key) ?? base[0]!;
    if (!list.some((v) => v.key === voiceA)) setVoiceA(female.key);
    if (!list.some((v) => v.key === voiceB)) setVoiceB(male.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voices.data]);

  React.useEffect(() => {
    const list = voices.data ?? [];
    if (!nameA) setNameA(list.find((v) => v.key === voiceA)?.name ?? '');
    if (!nameB) setNameB(list.find((v) => v.key === voiceB)?.name ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceA, voiceB, voices.data]);

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
  if (!nameA.trim() || !nameB.trim()) problems.push('Scrivi il nome dei due conduttori');
  if (!voiceA || !voiceB) problems.push('Scegli la voce dei due conduttori');

  /** Riferimento salvato per la voce scelta (chiave `provider:id`). */
  function voiceRef(key: string) {
    const v = (voices.data ?? []).find((x) => x.key === key);
    return { kind: 'catalog' as const, provider: v?.provider ?? ('polly' as const), id: v?.id ?? key };
  }
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
        hosts: [
          { key: 'A', name: nameA.trim(), voice: voiceRef(voiceA) },
          { key: 'B', name: nameB.trim(), voice: voiceRef(voiceB) },
        ],
        brief: {
          topic: topic.trim(),
          audience: audience.trim() || undefined,
          tone: tone.trim() || undefined,
          objectives: [],
          episodeMinutes: minutes,
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

      <Section n={3} title="Conduttori" hint="Due voci che dialogano in ogni puntata. Puoi ascoltarne l'anteprima prima di sceglierle.">
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
