'use client';
import * as React from 'react';
import { Loader2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { getApiClient } from '@/lib/api/client';
import type { PodcastVoiceOption } from '@scorm/contracts';
import { errText } from './podcast-labels';

/** Raggruppamento delle voci nell'elenco: prima le proprie, poi i cataloghi. */
const GROUPS: Array<{ label: string; test: (v: PodcastVoiceOption) => boolean }> = [
  { label: 'Le tue voci (HeyGen)', test: (v) => v.mine },
  { label: 'Amazon Polly', test: (v) => v.provider === 'polly' },
  { label: 'HeyGen', test: (v) => v.provider === 'heygen' && !v.mine && !v.accent },
  { label: 'HeyGen multilingua: possibile accento straniero', test: (v) => v.provider === 'heygen' && !v.mine && v.accent },
];

/** Scelta della voce di un conduttore, con anteprima. */
export function VoiceSelect({
  voices,
  value,
  language,
  onChange,
  label,
  disabled,
}: {
  voices: PodcastVoiceOption[];
  /** Chiave della voce scelta (`provider:id`). */
  value: string;
  language: string;
  onChange: (voiceKey: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const toast = useToast();
  const [playing, setPlaying] = React.useState(false);

  async function preview() {
    const option = voices.find((v) => v.key === value);
    if (!option) return;
    setPlaying(true);
    try {
      const { url } = await getApiClient().previewPodcastVoice(option.id, option.provider, language);
      const audio = new Audio(url);
      audio.onended = () => setPlaying(false);
      audio.onerror = () => setPlaying(false);
      await audio.play();
    } catch (e) {
      setPlaying(false);
      toast.show(errText(e, 'Anteprima non disponibile'), 'error');
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <Select aria-label={label} value={value} disabled={disabled || voices.length === 0} onChange={(e) => onChange(e.target.value)}>
          {voices.length === 0 && <option value="">Nessuna voce per questa lingua</option>}
          {GROUPS.map((g) => {
            const list = voices.filter(g.test);
            return list.length === 0 ? null : (
              <optgroup key={g.label} label={g.label}>
                {list.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.name} ({v.gender === 'female' ? 'donna' : v.gender === 'male' ? 'uomo' : 'voce'})
                  </option>
                ))}
              </optgroup>
            );
          })}
        </Select>
      </div>
      <Button type="button" variant="outline" size="icon" aria-label={`Ascolta la voce: ${label}`} onClick={() => void preview()} disabled={disabled || !value || playing}>
        {playing ? <Loader2 className="animate-spin" /> : <Play />}
      </Button>
    </div>
  );
}
