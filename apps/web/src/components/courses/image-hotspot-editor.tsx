'use client';

import * as React from 'react';
import { Plus, Trash2, Crosshair } from 'lucide-react';
import type { Block as BlockType } from '@scorm/contracts';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';

interface HotspotDraft {
  id: string;
  x: number;
  y: number;
  label: string;
  content: { format: 'html'; html: string };
}
interface ImageDraft {
  kind: 'image';
  storageKey?: string;
  alt?: string;
  source?: string;
  attribution?: Record<string, unknown>;
}

/** Estrae image + hotspots dal payload del block (con default sicuri). */
function readPayload(block: BlockType): { image: ImageDraft; hotspots: HotspotDraft[] } {
  const p = (block.payload ?? {}) as Record<string, unknown>;
  const img = (p.image ?? {}) as Record<string, unknown>;
  const image: ImageDraft = {
    kind: 'image',
    storageKey: typeof img.storageKey === 'string' ? img.storageKey : undefined,
    alt: typeof img.alt === 'string' ? img.alt : '',
    source: typeof img.source === 'string' ? img.source : undefined,
    attribution: (img.attribution as Record<string, unknown>) ?? undefined,
  };
  const hotspots: HotspotDraft[] = Array.isArray(p.hotspots)
    ? (p.hotspots as Record<string, unknown>[]).map((h) => ({
        id: typeof h.id === 'string' ? h.id : crypto.randomUUID(),
        x: typeof h.x === 'number' ? h.x : 0.5,
        y: typeof h.y === 'number' ? h.y : 0.5,
        label: typeof h.label === 'string' ? h.label : '',
        content:
          h.content && typeof h.content === 'object'
            ? (h.content as { format: 'html'; html: string })
            : { format: 'html', html: '' },
      }))
    : [];
  return { image, hotspots };
}

/**
 * Editor visuale del block image_hotspot: imposta l'immagine di sfondo (URL o
 * via «Immagini stock» a livello di lezione) e gestisce i pallini interattivi
 * (aggiungi cliccando sull'immagine, modifica etichetta/contenuto, rimuovi).
 * Emette il payload aggiornato a ogni modifica (il dialog valida con lo schema).
 */
export function ImageHotspotEditor({
  block,
  onChange,
}: {
  block: BlockType;
  onChange: (payload: { image: ImageDraft; hotspots: HotspotDraft[] }) => void;
}) {
  const initial = React.useMemo(() => readPayload(block), [block]);
  const [image, setImage] = React.useState<ImageDraft>(initial.image);
  const [hotspots, setHotspots] = React.useState<HotspotDraft[]>(initial.hotspots);
  const [selected, setSelected] = React.useState<string | null>(initial.hotspots[0]?.id ?? null);
  const [placing, setPlacing] = React.useState(false);

  // Propaga ogni modifica al dialog (che valida/anteprima/salva).
  React.useEffect(() => {
    onChange({ image, hotspots });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, hotspots]);

  function updateHotspot(id: string, patch: Partial<HotspotDraft>) {
    setHotspots((hs) => hs.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  }
  function addHotspot(x = 0.5, y = 0.5) {
    const h: HotspotDraft = { id: crypto.randomUUID(), x, y, label: 'Nuovo punto', content: { format: 'html', html: '' } };
    setHotspots((prev) => [...prev, h]);
    setSelected(h.id);
  }
  function removeHotspot(id: string) {
    setHotspots((hs) => hs.filter((h) => h.id !== id));
    setSelected((cur) => (cur === id ? null : cur));
  }

  function handleStageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!placing) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    if (selected) updateHotspot(selected, { x: round2(x), y: round2(y) });
    else addHotspot(round2(x), round2(y));
    setPlacing(false);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Immagine di sfondo */}
      <div className="space-y-2">
        <Label htmlFor="hs-img">URL immagine di sfondo</Label>
        <Input
          id="hs-img"
          value={image.storageKey ?? ''}
          onChange={(e) => setImage((im) => ({ ...im, storageKey: e.target.value || undefined }))}
          placeholder="https://… oppure usa «Immagini stock» nella lezione"
        />
        <Input
          aria-label="Testo alternativo immagine"
          value={image.alt ?? ''}
          onChange={(e) => setImage((im) => ({ ...im, alt: e.target.value }))}
          placeholder="Testo alternativo (accessibilità)"
        />
        <p className="text-xs text-muted-foreground">
          Puoi incollare un URL, oppure chiudere e usare il bottone «Immagini stock» della lezione
          per scaricare un&apos;immagine royalty-free su questo block.
        </p>
      </div>

      {/* Stage con i pallini */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Punti interattivi ({hotspots.length})</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={placing ? 'default' : 'outline'}
              onClick={() => setPlacing((v) => !v)}
              disabled={!image.storageKey}
            >
              <Crosshair className="size-4" />
              {placing ? 'Clicca sull’immagine…' : selected ? 'Riposiziona punto' : 'Posiziona nuovo'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => addHotspot()}>
              <Plus className="size-4" /> Punto
            </Button>
          </div>
        </div>

        {image.storageKey ? (
          <div
            className={`relative inline-block max-w-full overflow-hidden rounded-lg border ${placing ? 'cursor-crosshair ring-2 ring-primary' : ''}`}
            onClick={handleStageClick}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- anteprima editor, URL dinamico */}
            <img src={image.storageKey} alt={image.alt ?? ''} className="block max-h-[48vh] w-full object-contain" />
            {hotspots.map((h, i) => (
              <button
                key={h.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected(h.id);
                }}
                className={`absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white text-[11px] font-bold text-white shadow ${
                  selected === h.id ? 'ring-2 ring-primary' : ''
                }`}
                style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, background: 'var(--brand-primary, #4f46e5)' }}
                aria-label={h.label || `Punto ${i + 1}`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        ) : (
          <div className="grid aspect-video w-full max-w-md place-items-center rounded-lg border border-dashed bg-muted/40 text-sm text-muted-foreground">
            Imposta un&apos;immagine per aggiungere i punti.
          </div>
        )}
      </div>

      {/* Lista pallini editabili */}
      <div className="space-y-3">
        {hotspots.map((h, i) => (
          <div
            key={h.id}
            className={`rounded-lg border p-3 ${selected === h.id ? 'border-primary ring-1 ring-primary' : ''}`}
            onFocusCapture={() => setSelected(h.id)}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-muted-foreground">Punto {i + 1}</span>
              <Button type="button" size="icon" variant="ghost" aria-label="Rimuovi punto" onClick={() => removeHotspot(h.id)}>
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
            <Input
              aria-label={`Etichetta punto ${i + 1}`}
              value={h.label}
              onChange={(e) => updateHotspot(h.id, { label: e.target.value })}
              placeholder="Etichetta del punto"
              className="mb-2"
            />
            <textarea
              aria-label={`Contenuto punto ${i + 1}`}
              value={h.content.html}
              onChange={(e) => updateHotspot(h.id, { content: { format: 'html', html: e.target.value } })}
              placeholder="Contenuto (HTML) mostrato al clic sul punto"
              className="mb-2 h-20 w-full resize-none rounded-md border bg-background p-2 text-sm"
            />
            <div className="flex gap-2">
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                X
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={h.x}
                  onChange={(e) => updateHotspot(h.id, { x: clamp01(Number(e.target.value)) })}
                  className="h-8 w-20"
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                Y
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={h.y}
                  onChange={(e) => updateHotspot(h.id, { y: clamp01(Number(e.target.value)) })}
                  className="h-8 w-20"
                />
              </label>
            </div>
          </div>
        ))}
        {hotspots.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nessun punto. Aggiungine almeno uno (il block richiede un punto per essere valido).
          </p>
        )}
      </div>
    </div>
  );
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, round2(n)));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
