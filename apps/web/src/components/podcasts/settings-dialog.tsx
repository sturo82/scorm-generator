'use client';
import * as React from 'react';
import { PODCAST_CATEGORIES, type PodcastCategory, type PodcastView } from '@scorm/contracts';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { usePodcastActions, usePodcastVoices } from '@/lib/api/hooks';
import { errText } from './podcast-labels';
import { VoiceSelect } from './voice-select';

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

  React.useEffect(() => {
    if (!open) return;
    setTitle(podcast.title);
    setDescription(podcast.description);
    setCategory((podcast.category as PodcastCategory) ?? 'Education');
    setAuthor(podcast.author ?? '');
    setEmail(podcast.contactEmail ?? '');
    setExplicit(podcast.explicit);
    setHosts(podcast.hosts);
  }, [open, podcast]);

  const voicesChanged = JSON.stringify(hosts.map((h) => h.voice)) !== JSON.stringify(podcast.hosts.map((h) => h.voice));
  const patchHost = (key: 'A' | 'B', p: Partial<{ name: string; voiceId: string }>) =>
    setHosts((cur) => cur.map((h) => (h.key === key ? { ...h, ...(p.name !== undefined ? { name: p.name } : {}), ...(p.voiceId !== undefined ? { voice: { kind: 'catalog' as const, id: p.voiceId } } : {}) } : h)));

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
        <div className="grid gap-4 sm:grid-cols-2">
          {hosts.map((h) => (
            <div key={h.key} className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">Conduttore {h.key === 'A' ? 'principale' : 'ospite'}</p>
              <Input aria-label={`Nome del conduttore ${h.key}`} value={h.name} maxLength={40} onChange={(e) => patchHost(h.key, { name: e.target.value })} />
              <VoiceSelect voices={voices.data ?? []} value={h.voice.id} language={podcast.language} label={`Voce del conduttore ${h.key}`} onChange={(v) => patchHost(h.key, { voiceId: v })} />
            </div>
          ))}
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
