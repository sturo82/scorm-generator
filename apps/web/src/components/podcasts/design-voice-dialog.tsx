'use client';
import * as React from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { getApiClient } from '@/lib/api/client';
import { errText } from './podcast-labels';

/** Pezzi di descrizione da aggiungere con un clic: chi è, che età, come suona. */
const CHIPS: Array<{ group: string; items: string[] }> = [
  { group: 'Chi', items: ['Donna', 'Uomo'] },
  { group: 'Età', items: ['sui 25 anni', 'sui 35 anni', 'sui 50 anni', 'oltre i 60'] },
  { group: 'Voce', items: ['calda', 'profonda', 'chiara e brillante', 'roca', 'sottile'] },
  { group: 'Ritmo e tono', items: ['ritmo veloce', 'pacata', 'ironica', 'autorevole', 'entusiasta', 'sarcastica', 'rassicurante'] },
  { group: 'Accento', items: ['accento neutro', 'accento romano', 'accento milanese', 'accento del sud'] },
];

/**
 * Crea una voce nuova da una descrizione, senza clonare nessuno. HeyGen la prepara in pochi secondi;
 * poi compare tra «Le tue voci» e si può ascoltare e assegnare a un partecipante.
 */
export function DesignVoiceDialog({
  open,
  language,
  onClose,
  onCreated,
}: {
  open: boolean;
  language: string;
  onClose: () => void;
  /** Chiamata quando la voce è pronta, con la sua chiave (`heygen:<id>`). */
  onCreated: (voiceKey: string) => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [phase, setPhase] = React.useState<'form' | 'working' | 'ready'>('form');
  const [ready, setReady] = React.useState<{ id: string; previewUrl?: string } | null>(null);

  React.useEffect(() => {
    if (open) {
      setPhase('form');
      setReady(null);
    }
  }, [open]);

  const add = (text: string) => setDescription((d) => (d.trim() ? `${d.trim().replace(/[.,]$/, '')}, ${text}` : text));

  async function create() {
    setPhase('working');
    try {
      const api = getApiClient();
      const { voiceId } = await api.designPodcastVoice({ name: name.trim(), description: description.trim(), language });
      // La voce si prepara in pochi secondi: si controlla ogni 3 secondi, al massimo per 2 minuti.
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const st = await api.getPodcastVoiceDesignStatus(voiceId);
        if (st.status === 'FAILED') throw new Error('HeyGen non è riuscito a creare la voce: prova con un\u2019altra descrizione.');
        if (st.status === 'ACTIVE') {
          await qc.invalidateQueries({ queryKey: ['podcasts', 'voices'] });
          setReady({ id: voiceId, previewUrl: st.previewUrl });
          setPhase('ready');
          return;
        }
      }
      throw new Error('La voce ci sta mettendo troppo: riapri l\u2019elenco tra qualche minuto, comparirà tra le tue voci.');
    } catch (e) {
      toast.show(errText(e), 'error');
      setPhase('form');
    }
  }

  return (
    <Dialog open={open} onClose={phase === 'working' ? () => undefined : onClose} title="Crea una voce nuova" size="lg">
      {phase === 'ready' && ready ? (
        <div className="space-y-4">
          <p className="text-sm">La voce <strong>{name.trim()}</strong> è pronta. Ascoltala e, se ti piace, assegnala al partecipante.</p>
          {ready.previewUrl && (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- breve anteprima di una voce
            <audio controls src={ready.previewUrl} className="w-full" />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Chiudi</Button>
            <Button
              onClick={() => {
                onCreated(`heygen:${ready.id}`);
                onClose();
              }}
            >
              Usa questa voce
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Descrivi la voce che vuoi: HeyGen la inventa da zero, senza clonare nessuno. La voce vale per la lingua del podcast e resta tra le tue voci.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="dv-name">Nome della voce</Label>
            <Input id="dv-name" value={name} maxLength={60} placeholder="Es. Giulia, la scettica" onChange={(e) => setName(e.target.value)} disabled={phase === 'working'} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dv-desc">Com&apos;è la voce</Label>
            <Textarea
              id="dv-desc"
              rows={4}
              maxLength={500}
              value={description}
              disabled={phase === 'working'}
              placeholder="Es. Donna sui 35 anni, voce calda e vivace, ritmo veloce, ironica, tono da chiacchierata tra amici"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            {CHIPS.map((g) => (
              <div key={g.group} className="flex flex-wrap items-center gap-1.5">
                <span className="w-24 text-xs text-muted-foreground">{g.group}</span>
                {g.items.map((it) => (
                  <Button key={it} type="button" size="sm" variant="outline" disabled={phase === 'working'} onClick={() => add(it)}>
                    {it}
                  </Button>
                ))}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={phase === 'working'}>Annulla</Button>
            <Button onClick={() => void create()} disabled={phase === 'working' || !name.trim() || description.trim().length < 10}>
              {phase === 'working' ? <Loader2 className="animate-spin" /> : <Sparkles />} {phase === 'working' ? 'Creo la voce…' : 'Crea la voce'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
