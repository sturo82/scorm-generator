'use client';

import * as React from 'react';
import { Plus, Trash2, Clock, Loader2, X } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { TranscriptCue } from '@/lib/api/types';

interface EditableCue {
  id: string;
  start: number;
  text: string;
}

/** m:ss ↔ secondi, per i campi tempo. */
function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
function parseTime(v: string): number | null {
  const t = v.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t); // secondi puri
  const m = t.match(/^(\d+):([0-5]?\d)(\.\d+)?$/); // m:ss(.ms)
  if (m) return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) : 0);
  return null;
}

/**
 * Editor della trascrizione di un video (cue con timestamp). Mostra il video a
 * sinistra e la lista di righe a destra: per ogni riga tempo di inizio + testo.
 * "Usa tempo corrente" cattura il secondo esatto dal player, così i tempi sono
 * quelli REALI del video. Al salvataggio le cue vengono ordinate per tempo.
 */
export function TranscriptEditorDialog({
  open,
  videoUrl,
  initial,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  videoUrl?: string | null;
  initial: TranscriptCue[];
  saving: boolean;
  onClose: () => void;
  onSave: (cues: TranscriptCue[]) => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [cues, setCues] = React.useState<EditableCue[]>([]);

  React.useEffect(() => {
    if (!open) return;
    setCues(
      (initial ?? []).map((c, i) => ({ id: c.id || `cue-${i}`, start: c.start, text: c.text })),
    );
  }, [open, initial]);

  const addRow = () => {
    const now = videoRef.current?.currentTime ?? 0;
    setCues((prev) => [...prev, { id: `cue-${Date.now()}`, start: Math.round(now * 10) / 10, text: '' }]);
  };
  const setStartFromVideo = (id: string) => {
    const now = videoRef.current?.currentTime ?? 0;
    setCues((prev) => prev.map((c) => (c.id === id ? { ...c, start: Math.round(now * 10) / 10 } : c)));
  };
  const seekTo = (s: number) => {
    const v = videoRef.current;
    if (v) { v.currentTime = s; void v.play().catch(() => undefined); }
  };

  const handleSave = () => {
    const clean = cues
      .filter((c) => c.text.trim().length > 0)
      .map((c, i) => ({ id: `cue-${i}`, start: Math.max(0, c.start), text: c.text.trim() }))
      .sort((a, b) => a.start - b.start);
    onSave(clean);
  };

  return (
    <Dialog open={open} onClose={onClose} title="Trascrizione del video">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Player per catturare i tempi reali */}
        <div className="space-y-2">
          {videoUrl ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video ref={videoRef} controls preload="metadata" src={videoUrl} className="aspect-video w-full rounded-lg bg-black" />
          ) : (
            <div className="grid aspect-video w-full place-items-center rounded-lg border border-dashed bg-muted/40 text-xs text-muted-foreground">
              Carica prima un video per catturare i tempi.
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Metti in pausa il video al punto giusto e usa <strong>Usa tempo corrente</strong> su una
            riga per sincronizzarla. Il tempo si scrive come <code>m:ss</code> o secondi.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="size-4" /> Aggiungi riga
          </Button>
        </div>

        {/* Lista cue editabili */}
        <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
          {cues.length === 0 && (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              Nessuna riga. Aggiungine una e scrivi cosa viene detto, con il tempo di inizio.
            </p>
          )}
          {cues.map((c) => (
            <div key={c.id} className="flex items-start gap-2 rounded-lg border p-2">
              <div className="flex flex-col items-stretch gap-1">
                <button
                  type="button"
                  onClick={() => seekTo(c.start)}
                  title="Vai a questo punto"
                  className="rounded bg-accent px-1.5 py-0.5 text-xs font-mono tabular-nums text-accent-foreground hover:bg-accent/70"
                >
                  {fmt(c.start)}
                </button>
                <Input
                  aria-label="Tempo di inizio"
                  defaultValue={fmt(c.start)}
                  onBlur={(e) => {
                    const parsed = parseTime(e.target.value);
                    if (parsed != null) setCues((prev) => prev.map((x) => (x.id === c.id ? { ...x, start: parsed } : x)));
                    else e.target.value = fmt(c.start);
                  }}
                  className="h-7 w-16 px-1 text-center text-xs"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Usa tempo corrente del video"
                  title="Usa tempo corrente del video"
                  onClick={() => setStartFromVideo(c.id)}
                >
                  <Clock className="size-3.5" />
                </Button>
              </div>
              <textarea
                value={c.text}
                onChange={(e) => setCues((prev) => prev.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)))}
                placeholder="Testo del parlato…"
                rows={2}
                className="min-h-[3rem] flex-1 resize-y rounded-md border bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Rimuovi riga"
                className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => setCues((prev) => prev.filter((x) => x.id !== c.id))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2 border-t pt-3">
        <Button type="button" variant="outline" onClick={onClose}>
          <X className="size-4" /> Annulla
        </Button>
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Salva trascrizione
        </Button>
      </div>
    </Dialog>
  );
}
