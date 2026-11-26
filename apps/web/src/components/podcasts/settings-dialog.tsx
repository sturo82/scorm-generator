'use client';
import * as React from 'react';
import { PODCAST_CATEGORIES, type PodcastCategory, type PodcastView } from '@scorm/contracts';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { usePodcastActions, usePodcastVoices } from '@/lib/api/hooks';
import { PODCAST_ENERGY, errText } from './podcast-labels';
import { HostsEditor } from './hosts-editor';

/** Impostazioni della serie: dati del feed e conduttori. */
export function SettingsDialog({ podcast, open, onClose }: { podcast: PodcastView; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const act = usePodcastActions(podcast.id);
  const voices = usePodcastVoices(podcast.language);
  const [title, setTitle] = React.useState(podcast.title);
  const [description, setDescription] = React.useState(podcast.description);
  const [category, setCategory] = React.useState<PodcastCategory>((podcast.category as PodcastCategory) ?? 'Education');
  const [author, setAuthor] = React.useState(podcast.author ?? '');
  const [email, setEmail] = React.useState(podcast.contactEmail ?? '');
  const [explicit, setExplicit] = React.useState(podcast.explicit);
  const [hosts, setHosts] = React.useState(podcast.hosts);
  const [energy, setEnergy] = React.useState(podcast.brief.energy ?? 'lively');

  React.useEffect(() => {
    if (!open) return;
    setTitle(podcast.title);
    setDescription(podcast.description);
    setCategory((podcast.category as PodcastCategory) ?? 'Education');
    setAuthor(podcast.author ?? '');
    setEmail(podcast.contactEmail ?? '');
    setExplicit(podcast.explicit);
    setHosts(podcast.hosts);
    setEnergy(podcast.brief.energy ?? 'lively');
  }, [open, podcast]);

  const voicesChanged = JSON.stringify(hosts.map((h) => h.voice)) !== JSON.stringify(podcast.hosts.map((h) => h.voice));

  async function save() {
    try {
      await act.update.mutateAsync({
        title: title.trim(),
        description: description.trim(),
        category,
        author: author.trim() || null,
        contactEmail: email.trim() || null,
        explicit,
        hosts,
        brief: { ...podcast.brief, energy },
      });
      toast.show('Impostazioni salvate', 'success');
      onClose();
    } catch (e) {
      toast.show(errText(e), 'error');
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Impostazioni del podcast" size="lg">
      <div className="max-h-[70vh] space-y-4 overflow-auto pr-1">
        <div className="space-y-1.5">
          <Label htmlFor="st-title">Titolo</Label>
          <Input id="st-title" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="st-desc">Descrizione</Label>
          <Textarea id="st-desc" rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="st-cat">Categoria</Label>
            <Select id="st-cat" value={category} onChange={(e) => setCategory(e.target.value as PodcastCategory)}>
              {PODCAST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-author">Autore</Label>
            <Input id="st-author" value={author} maxLength={100} onChange={(e) => setAuthor(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-email">Email di contatto</Label>
            <Input id="st-email" type="email" value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={explicit} onChange={(e) => setExplicit(e.target.checked)} />
            Contenuto per adulti
          </label>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="st-energy">Ritmo e stile della conversazione</Label>
          <Select id="st-energy" value={energy} onChange={(e) => setEnergy(e.target.value as 'relaxed' | 'lively' | 'wild')}>
            {PODCAST_ENERGY.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">{PODCAST_ENERGY.find((o) => o.value === energy)?.hint} Vale per i copioni che scrivi da ora e per il montaggio dell&apos;audio.</p>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Partecipanti</p>
          <HostsEditor hosts={hosts} voices={voices.data ?? []} language={podcast.language} onChange={setHosts} />
          <p className="text-xs text-muted-foreground">Il carattere dei partecipanti vale per i copioni che scrivi da ora: per cambiare una puntata già scritta usa «Riscrivi il copione».</p>
        </div>
        {voicesChanged && podcast.episodes.some((e) => e.hasAudio) && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Cambiando le voci, l&apos;audio già registrato risulterà da rifare (con il suo costo).</p>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Annulla
        </Button>
        <Button onClick={() => void save()} disabled={!title.trim() || hosts.some((h) => !h.name.trim()) || act.update.isPending}>
          Salva
        </Button>
      </div>
    </Dialog>
  );
}
