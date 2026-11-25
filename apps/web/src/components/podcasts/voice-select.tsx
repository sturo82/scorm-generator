'use client';
import * as React from 'react';
import { Loader2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { getApiClient } from '@/lib/api/client';
import type { PodcastVoiceOption } from '@scorm/contracts';
import { errText } from './podcast-labels';

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
  value: string;
  language: string;
  onChange: (voiceId: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const toast = useToast();
  const [playing, setPlaying] = React.useState(false);

  async function preview() {
    if (!value) return;
    setPlaying(true);
    try {
      const { url } = await getApiClient().previewPodcastVoice(value, language);
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
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.gender === 'female' ? 'donna' : v.gender === 'male' ? 'uomo' : 'voce'})
            </option>
          ))}
        </Select>
      </div>
      <Button type="button" variant="outline" size="icon" aria-label={`Ascolta la voce: ${label}`} onClick={() => void preview()} disabled={disabled || !value || playing}>
        {playing ? <Loader2 className="animate-spin" /> : <Play />}
      </Button>
    </div>
  );
}
