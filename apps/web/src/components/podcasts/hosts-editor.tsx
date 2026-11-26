'use client';
import * as React from 'react';
import { ChevronDown, Plus, Sparkles, Trash2 } from 'lucide-react';
import { PODCAST_LIMITS, podcastVoiceKey, type PodcastHost, type PodcastPersona, type PodcastVoiceOption } from '@scorm/contracts';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { usePodcastVoiceCapabilities } from '@/lib/api/hooks';
import { DesignVoiceDialog } from './design-voice-dialog';
import { VoiceSelect } from './voice-select';

const KEYS = ['A', 'B', 'C', 'D'] as const;

/** Caratteri di partenza: riempiono ruolo, carattere e modo di parlare, poi si possono cambiare. */
const PRESETS: Array<{ label: string; persona: PodcastPersona }> = [
  {
    label: 'Il conduttore curioso',
    persona: {
      role: 'Conduce la puntata e fa le domande che si farebbe chi ascolta',
      personality: 'Curioso, empatico, un po\u2019 ironico',
      speech: 'Frasi brevi, domande dirette, riassume solo quando serve',
    },
  },
  {
    label: 'L\u2019esperto',
    persona: {
      role: 'Porta competenza, dati ed esempi',
      personality: 'Preciso e pacato, a volte pedante, ama i dettagli',
      speech: 'Esempi concreti, cita numeri, corregge con garbo',
    },
  },
  {
    label: 'Lo scettico',
    persona: {
      role: 'Mette in dubbio e fa l\u2019avvocato del diavolo',
      personality: 'Pragmatico, diffidente verso le mode, battuta pronta',
      speech: 'Interrompe volentieri, ironia secca, frasi taglienti',
    },
  },
  {
    label: 'L\u2019entusiasta',
    persona: {
      role: 'Porta energia e collega i temi alla vita di tutti i giorni',
      personality: 'Entusiasta, impulsivo, ride facilmente',
      speech: 'Parla veloce, si sovrappone, esclamazioni e aneddoti',
    },
  },
];

/** Prima voce libera: preferisce una non ancora usata, di Polly e di genere diverso dall'ultima scelta. */
export function nextVoice(voices: PodcastVoiceOption[], used: PodcastHost[]): PodcastHost['voice'] | null {
  const taken = new Set(used.map((h) => podcastVoiceKey(h.voice)));
  const lastGender = voices.find((v) => v.key === (used[used.length - 1] ? podcastVoiceKey(used[used.length - 1]!.voice) : ''))?.gender;
  const free = voices.filter((v) => !taken.has(v.key));
  const pool = free.some((v) => v.provider === 'polly') ? free.filter((v) => v.provider === 'polly') : free;
  const pick = pool.find((v) => lastGender && v.gender !== 'unknown' && v.gender !== lastGender) ?? pool[0] ?? voices[0];
  return pick ? { kind: 'catalog', provider: pick.provider, id: pick.id } : null;
}

/**
 * Elenco dei partecipanti: da uno a quattro, ciascuno con nome, voce e carattere. Con uno solo il podcast
 * è un monologo; da due in su è una discussione, e il carattere di ognuno orienta cosa e come dice.
 */
export function HostsEditor({
  hosts,
  voices,
  language,
  onChange,
}: {
  hosts: PodcastHost[];
  voices: PodcastVoiceOption[];
  language: string;
  onChange: (hosts: PodcastHost[]) => void;
}) {
  const [open, setOpen] = React.useState<string | null>(null);
  const caps = usePodcastVoiceCapabilities();
  // Partecipante per cui si sta creando una voce nuova.
  const [designFor, setDesignFor] = React.useState<string | null>(null);
  const patch = (key: string, p: Partial<PodcastHost>) => onChange(hosts.map((h) => (h.key === key ? { ...h, ...p } : h)));
  const refOf = (voiceKey: string): PodcastHost['voice'] => {
    const v = voices.find((x) => x.key === voiceKey);
    if (v) return { kind: 'catalog', provider: v.provider, id: v.id };
    // Voce appena creata, non ancora nell'elenco: la chiave è `provider:id`.
    const [provider, ...rest] = voiceKey.split(':');
    return { kind: 'catalog', provider: provider === 'heygen' ? 'heygen' : 'polly', id: rest.length > 0 ? rest.join(':') : voiceKey };
  };
  const label = (i: number) => (hosts.length === 1 ? 'Voce narrante' : i === 0 ? 'Conduttore principale' : `Partecipante ${i + 1}`);

  function add() {
    const key = KEYS.find((k) => !hosts.some((h) => h.key === k));
    const voice = nextVoice(voices, hosts);
    if (!key || !voice) return;
    onChange([...hosts, { key, name: '', voice }]);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {hosts.length === 1
          ? 'Con una sola voce la puntata è un monologo. Aggiungi un partecipante per farne una discussione.'
          : 'Con più partecipanti la puntata è una discussione: ognuno ha un carattere, un\u2019opinione e un modo di parlare, e le battute si incrociano e si sovrappongono.'}
      </p>
      {hosts.map((h, i) => {
        const persona = h.persona ?? {};
        const isOpen = open === h.key;
        return (
          <div key={h.key} className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{label(i)}</p>
              {hosts.length > 1 && (
                <Button type="button" variant="ghost" size="sm" aria-label={`Togli ${h.name || label(i)}`} onClick={() => onChange(hosts.filter((x) => x.key !== h.key))}>
                  <Trash2 /> Togli
                </Button>
              )}
            </div>
            <Input aria-label={`Nome del partecipante ${h.key}`} placeholder="Nome" value={h.name} maxLength={40} onChange={(e) => patch(h.key, { name: e.target.value })} />
            <VoiceSelect voices={voices} value={podcastVoiceKey(h.voice)} language={language} label={`Voce del partecipante ${h.key}`} onChange={(v) => patch(h.key, { voice: refOf(v) })} />
            {caps.data?.design && (
              <button type="button" className="flex items-center gap-1 text-xs font-medium text-primary" onClick={() => setDesignFor(h.key)}>
                <Sparkles className="size-3.5" /> Crea una voce nuova per {h.name || 'questo partecipante'}
              </button>
            )}
            <button type="button" className="flex items-center gap-1 text-xs font-medium text-primary" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : h.key)}>
              <ChevronDown className={`size-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              Carattere e storia {persona.role || persona.personality || persona.background || persona.speech ? '(impostati)' : '(facoltativo)'}
            </button>
            {isOpen && (
              <div className="space-y-3 rounded-md bg-muted/40 p-3">
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <Button key={p.label} type="button" size="sm" variant="outline" onClick={() => patch(h.key, { persona: { ...persona, ...p.persona } })}>
                      {p.label}
                    </Button>
                  ))}
                </div>
                <Field label="Ruolo nella discussione" value={persona.role} placeholder="Es. conduce, porta i dati, fa l\u2019avvocato del diavolo" onChange={(v) => patch(h.key, { persona: { ...persona, role: v } })} />
                <Field label="Chi è (studi, lavoro, esperienze)" value={persona.background} area placeholder="Es. ingegnere informatico, 15 anni in banca, poi consulente di innovazione" onChange={(v) => patch(h.key, { persona: { ...persona, background: v } })} />
                <Field label="Carattere" value={persona.personality} area placeholder="Es. ironico, impaziente, ama le provocazioni" onChange={(v) => patch(h.key, { persona: { ...persona, personality: v } })} />
                <Field label="Come parla" value={persona.speech} area placeholder="Es. frasi corte, intercala «cioè», fa battute, interrompe" onChange={(v) => patch(h.key, { persona: { ...persona, speech: v } })} />
              </div>
            )}
          </div>
        );
      })}
      <DesignVoiceDialog
        open={designFor !== null}
        language={language}
        onClose={() => setDesignFor(null)}
        onCreated={(voiceKey) => {
          const key = designFor;
          if (key) patch(key, { voice: refOf(voiceKey) });
        }}
      />
      {hosts.length < PODCAST_LIMITS.maxHosts && (
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={voices.length === 0}>
          <Plus /> Aggiungi un partecipante
        </Button>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, area }: { label: string; value?: string; onChange: (v: string | undefined) => void; placeholder?: string; area?: boolean }) {
  const id = React.useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {area ? (
        <Textarea id={id} rows={2} maxLength={400} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value || undefined)} />
      ) : (
        <Input id={id} maxLength={120} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value || undefined)} />
      )}
    </div>
  );
}
