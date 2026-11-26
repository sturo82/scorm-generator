'use client';
import * as React from 'react';
import { Lightbulb, Loader2, Plus } from 'lucide-react';
import type { PodcastIdea, PodcastView } from '@scorm/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { usePodcastActions } from '@/lib/api/hooks';
import { errText } from './podcast-labels';

/** Idee per le prossime puntate: l'AI propone, l'utente sceglie quali trasformare in puntata. Non crea nulla da sola. */
export function IdeasCard({ podcast, disabled, onUse }: { podcast: PodcastView; disabled: boolean; onUse: (idea: PodcastIdea) => void }) {
  const toast = useToast();
  const act = usePodcastActions(podcast.id);
  const [focus, setFocus] = React.useState('');
  const [ideas, setIdeas] = React.useState<PodcastIdea[]>([]);
  const [open, setOpen] = React.useState(false);

  async function suggest() {
    try {
      setIdeas(await act.ideas.mutateAsync({ count: 5, focus: focus.trim() || undefined }));
    } catch (e) {
      toast.show(errText(e), 'error');
    }
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)} disabled={disabled}>
        <Lightbulb /> Idee per le prossime puntate
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1.5 font-semibold">
              <Lightbulb className="size-4 text-primary" /> Idee per le prossime puntate
            </h2>
            <p className="text-xs text-muted-foreground">L&apos;AI propone cinque argomenti diversi dalle puntate che hai già. Scegli quelli che ti piacciono: costa quanto un testo breve.</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Chiudi
          </Button>
        </div>
        <div className="flex gap-2">
          <Input aria-label="Argomento su cui orientare le idee" value={focus} maxLength={500} onChange={(e) => setFocus(e.target.value)} placeholder="Su cosa vuoi puntare? (facoltativo)" />
          <Button onClick={() => void suggest()} disabled={act.ideas.isPending}>
            {act.ideas.isPending ? <Loader2 className="animate-spin" /> : null} {ideas.length > 0 ? 'Altre idee' : 'Proponi idee'}
          </Button>
        </div>
        {ideas.length > 0 && (
          <ul className="space-y-2">
            {ideas.map((i) => (
              <li key={i.title} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="font-medium">{i.title}</p>
                  <p className="text-sm text-muted-foreground">{i.summary}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => onUse(i)}>
                  <Plus /> Usa
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
