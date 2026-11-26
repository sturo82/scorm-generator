'use client';
import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { PODCAST_LIMITS, podcastScriptFit, podcastScriptWords, type PodcastHost, type PodcastMood, type PodcastOverlap, type PodcastScript } from '@scorm/contracts';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/input';

const OVERLAP_LABELS: Record<PodcastOverlap, string> = {
  cut_in: 'Interrompe l\u2019altro',
  reaction: 'Reazione sopra l\u2019altro',
  over: 'Si parlano sopra',
};
const MOOD_LABELS: Record<PodcastMood, string> = {
  excited: 'Entusiasta',
  amused: 'Divertito',
  surprised: 'Sorpreso',
  sarcastic: 'Sarcastico',
  warm: 'Caloroso',
  serious: 'Serio',
  calm: 'Calmo',
  frustrated: 'Frustrato',
  thoughtful: 'Pensieroso',
  laughing: 'Ride',
  shouting: 'Urla',
  scoffing: 'Sbuffa',
};

/** Editor del copione: una riga per battuta, con chi parla, come entra nel discorso e il tono. */
export function ScriptEditor({
  script,
  hosts,
  minutes,
  saving,
  onSave,
  onCancel,
}: {
  script: PodcastScript;
  hosts: PodcastHost[];
  minutes: number;
  saving: boolean;
  onSave: (script: PodcastScript) => void;
  onCancel: () => void;
}) {
  const [turns, setTurns] = React.useState(script.turns);
  const words = podcastScriptWords({ turns });
  const fit = podcastScriptFit(words, minutes);
  const tooLong = turns.some((t) => t.text.length > PODCAST_LIMITS.maxTurnChars);
  const invalid = turns.length < PODCAST_LIMITS.minTurns || turns.some((t) => !t.text.trim()) || tooLong;
  const patch = (i: number, p: Partial<PodcastScript['turns'][number]>) => setTurns((cur) => cur.map((t, k) => (k === i ? { ...t, ...p } : t)));

  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {turns.map((t, i) => (
          <li key={i} className="grid gap-2 sm:grid-cols-[150px_1fr_auto]">
            <Select aria-label={`Chi parla alla battuta ${i + 1}`} value={t.host} onChange={(e) => patch(i, { host: e.target.value as PodcastHost['key'] })}>
              {hosts.map((h) => (
                <option key={h.key} value={h.key}>
                  {h.name}
                </option>
              ))}
            </Select>
            <div className="space-y-1.5">
              <Textarea aria-label={`Testo della battuta ${i + 1}`} rows={Math.min(6, Math.max(2, Math.ceil(t.text.length / 90)))} value={t.text} onChange={(e) => patch(i, { text: e.target.value })} />
              {hosts.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  <Select aria-label={`Come entra la battuta ${i + 1}`} className="h-8 w-52 text-xs" value={t.overlap ?? ''} disabled={i === 0} onChange={(e) => patch(i, { overlap: (e.target.value || undefined) as PodcastOverlap | undefined })}>
                    <option value="">Parla dopo l&apos;altro</option>
                    {(Object.keys(OVERLAP_LABELS) as PodcastOverlap[]).map((k) => (
                      <option key={k} value={k}>
                        {OVERLAP_LABELS[k]}
                      </option>
                    ))}
                  </Select>
                  <Select aria-label={`Tono della battuta ${i + 1}`} className="h-8 w-44 text-xs" value={t.mood ?? ''} onChange={(e) => patch(i, { mood: (e.target.value || undefined) as PodcastMood | undefined })}>
                    <option value="">Tono neutro</option>
                    {(Object.keys(MOOD_LABELS) as PodcastMood[]).map((k) => (
                      <option key={k} value={k}>
                        {MOOD_LABELS[k]}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
            <div className="flex gap-1 sm:flex-col">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Aggiungi una battuta dopo la ${i + 1}`}
                onClick={() => setTurns((cur) => [...cur.slice(0, i + 1), { host: hosts[(hosts.findIndex((h) => h.key === t.host) + 1) % hosts.length]!.key, text: '' }, ...cur.slice(i + 1)])}
              >
                <Plus />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`Togli la battuta ${i + 1}`} disabled={turns.length <= PODCAST_LIMITS.minTurns} onClick={() => setTurns((cur) => cur.filter((_, k) => k !== i))}>
                <Trash2 />
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <p className={fit.status === 'ok' ? 'text-xs text-muted-foreground' : 'text-xs text-amber-800'}>
        {words} parole · circa {fit.estMinutes} min (previsti {minutes}
        {fit.status === 'long' ? ': troppo lungo' : fit.status === 'short' ? ': troppo corto' : ''}). Le modifiche rendono da rifare l&apos;audio.
      </p>
      {tooLong && <p className="text-xs text-destructive">Una battuta supera {PODCAST_LIMITS.maxTurnChars} caratteri: dividila.</p>}
      <div className="flex gap-2">
        <Button type="button" disabled={invalid || saving} onClick={() => onSave({ turns: turns.map((t, i) => ({ host: t.host, text: t.text.trim(), ...(i > 0 && t.overlap ? { overlap: t.overlap } : {}), ...(t.mood ? { mood: t.mood } : {}) })) })}>
          Salva il copione
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Annulla
        </Button>
      </div>
    </div>
  );
}
