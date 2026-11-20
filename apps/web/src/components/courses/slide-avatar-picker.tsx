'use client';

import * as React from 'react';
import { Check, Search } from 'lucide-react';
import {
  avatarFeature,
  HEYGEN_ENGINES,
  heygenAvatarTypeLabel,
  heygenBillingTypeFor,
  heygenCostPerMinUsd,
  heygenEngineSupports,
} from '@scorm/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { useCreditQuote, useVideoAvatars, useVideoVoices, useWallet } from '@/lib/api/hooks';

export type AvatarEngine = 'avatar_iii' | 'avatar_iv' | 'avatar_v';
export type AvatarChoice = {
  avatarId: string;
  avatarType: 'photo' | 'studio' | 'digital_twin';
  engine: AvatarEngine;
  voiceId?: string;
};

const SELECT =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Scelta di avatar, qualità e voce per il video da slide: i tuoi avatar (solo quelli a cui hai
 * accesso) o il catalogo HeyGen, con ricerca. Il tipo di avatar, e quindi la tariffa, segue
 * l'avatar scelto. `onChange` riceve `null` finché non è stato scelto un avatar.
 */
export function SlideAvatarPicker({
  courseId,
  language,
  onChange,
}: {
  courseId: string;
  /** Lingua del parlato: filtra le voci proposte. */
  language?: string;
  onChange: (choice: AvatarChoice | null) => void;
}) {
  const billed = useWallet().data?.enabled === true;
  const [source, setSource] = React.useState<'mine' | 'stock'>('mine');
  const [query, setQuery] = React.useState('');
  const q = useDebounced(query.trim(), 350);
  const [avatarId, setAvatarId] = React.useState('');
  const [voiceId, setVoiceId] = React.useState('');
  const [engine, setEngine] = React.useState<AvatarEngine>('avatar_iii');

  const avatars = useVideoAvatars(courseId, true, { source, q });
  const voices = useVideoVoices(courseId, true, language ? { language } : undefined);
  const avatarItems = React.useMemo(() => avatars.data?.pages.flatMap((p) => p.items) ?? [], [avatars.data]);
  const voiceItems = React.useMemo(() => voices.data?.pages.flatMap((p) => p.items) ?? [], [voices.data]);
  const selected = avatarItems.find((a) => a.id === avatarId);
  const avatarType = selected ? heygenBillingTypeFor({ source: selected.source, groupType: selected.groupType }) : source === 'mine' ? 'photo' : 'studio';

  // Qualità coerente con il tipo di avatar.
  React.useEffect(() => {
    if (!heygenEngineSupports(engine, avatarType)) setEngine('avatar_iii');
  }, [avatarType, engine]);

  const engineOptions = HEYGEN_ENGINES.filter((e) => heygenEngineSupports(e.id, avatarType));
  const quote = useCreditQuote(engineOptions.map((e) => ({ feature: avatarFeature(e.id, avatarType), units: 1 })));
  const credits = (id: string) => quote.data?.lines.find((l) => l.feature === avatarFeature(id, avatarType))?.credits;

  React.useEffect(() => {
    onChange(avatarId ? { avatarId, avatarType, engine, ...(voiceId ? { voiceId } : {}) } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarId, avatarType, engine, voiceId]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">Avatar</p>
          <div className="flex gap-1 text-xs">
            {(['mine', 'stock'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSource(s);
                  setAvatarId('');
                }}
                className={cn('rounded-md border px-2 py-1', source === s ? 'border-primary bg-accent/50' : 'hover:bg-accent/30')}
              >
                {s === 'mine' ? 'I miei' : 'Catalogo HeyGen'}
              </button>
            ))}
          </div>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca un avatar per nome" className="h-9 pl-8" aria-label="Cerca un avatar" />
        </div>
        {avatars.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : avatarItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {source === 'mine' ? 'Non hai ancora avatar: scegli dal catalogo o creane uno in Impostazioni → Avatar.' : 'Nessun avatar trovato.'}
          </p>
        ) : (
          <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto rounded-lg border p-2 sm:grid-cols-5">
            {avatarItems.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAvatarId(a.id)}
                className={cn('relative overflow-hidden rounded-md border text-left', avatarId === a.id && 'border-primary ring-2 ring-primary/40')}
                title={a.name}
              >
                {a.previewUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- anteprima remota
                  <img src={a.previewUrl} alt="" className="aspect-square w-full object-cover" />
                )}
                <span className="block truncate px-1 pt-0.5 text-[11px]">{a.name}</span>
                <span className="block truncate px-1 pb-0.5 text-[10px] text-muted-foreground">
                  {heygenAvatarTypeLabel({ source: a.source, groupType: a.groupType })}
                </span>
                {avatarId === a.id && <Check className="absolute right-1 top-1 size-4 rounded-full bg-primary p-0.5 text-primary-foreground" />}
              </button>
            ))}
          </div>
        )}
        {avatars.hasNextPage && (
          <Button type="button" size="sm" variant="ghost" onClick={() => avatars.fetchNextPage()} disabled={avatars.isFetchingNextPage}>
            Carica altri avatar
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Qualità</span>
          <select className={SELECT} value={engine} onChange={(e) => setEngine(e.target.value as AvatarEngine)}>
            {engineOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label} ·{' '}
                {billed
                  ? credits(e.id) != null
                    ? `${credits(e.id)!.toLocaleString('it-IT')} crediti/min`
                    : 'prezzo n.d.'
                  : `$${heygenCostPerMinUsd(e.id, avatarType).toFixed(2)}/min`}
              </option>
            ))}
          </select>
          <span className="block text-[11px] text-muted-foreground">Di partenza la più economica.</span>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Voce</span>
          <select className={SELECT} value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
            <option value="">Voce predefinita dell&apos;avatar</option>
            {voiceItems.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.gender ? ` · ${v.gender}` : ''}
              </option>
            ))}
          </select>
          <span className="block text-[11px] text-muted-foreground">Se l&apos;avatar non ha una voce, scegline una nella lingua del corso.</span>
        </label>
      </div>
    </div>
  );
}
