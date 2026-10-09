'use client';

import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { Block } from '@scorm/contracts';
import type { Block as BlockType } from '@scorm/contracts';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { BlockRenderer } from '@/components/courses/block-renderer';
import { ImageHotspotEditor } from '@/components/courses/image-hotspot-editor';
import { BlockFormEditor, isFormEditable } from '@/components/courses/block-form-editor';

/** Etichette leggibili dei tipi (titolo del dialog). */
const TYPE_LABELS: Record<string, string> = {
  rich_text: 'Testo',
  image_hotspot: 'Immagine interattiva',
  accordion_tabs: 'Accordion / Tab',
  flashcard: 'Flashcard',
  timeline: 'Timeline',
  carousel_steps: 'Passi',
  click_reveal: 'Click & reveal',
  branching_scenario: 'Scenario',
  video_checkpoint: 'Video',
  dragdrop_match: 'Abbinamento',
  dragdrop_order: 'Ordinamento',
  sorting_categories: 'Classificazione',
};

/**
 * Editor di un singolo Block, enterprise: pannello largo con editor visuale a
 * sinistra (form per-tipo o editor dedicato dell'immagine interattiva) e
 * anteprima dal vivo a destra. L'editor JSON resta disponibile in «Avanzato»
 * (ed è l'unica via per i tipi non ancora coperti da un form). Qualunque
 * modifica è validata con lo schema Zod `Block` prima del salvataggio.
 */
export function BlockEditorDialog({
  open,
  block,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  block: BlockType | null;
  onClose: () => void;
  onSave: (updated: BlockType) => void;
  saving?: boolean;
}) {
  const [text, setText] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<BlockType | null>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  React.useEffect(() => {
    if (block) {
      setText(JSON.stringify(block, null, 2));
      setPreview(block);
      setError(null);
      setAdvancedOpen(false);
    }
  }, [block]);

  function validate(raw: string): BlockType | null {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (e) {
      setError(`JSON non valido: ${e instanceof Error ? e.message : 'errore di sintassi'}`);
      return null;
    }
    const result = Block.safeParse(parsedJson);
    if (!result.success) {
      const first = result.error.issues[0];
      setError(`Schema non valido: ${first ? `${first.path.join('.')} — ${first.message}` : 'struttura errata'}`);
      return null;
    }
    setError(null);
    return result.data;
  }

  // Applica un payload strutturato (dagli editor visuali) al block, validandolo
  // e tenendo in sincrono anteprima + testo JSON dell'avanzato.
  function applyPayload(payload: Record<string, unknown>) {
    if (!block) return;
    const candidate = { ...block, payload } as unknown;
    const result = Block.safeParse(candidate);
    if (result.success) {
      setPreview(result.data);
      setText(JSON.stringify(result.data, null, 2));
      setError(null);
    } else {
      const first = result.error.issues[0];
      setError(first ? `${first.path.join('.')} — ${first.message}` : 'struttura non valida');
      setText(JSON.stringify(candidate, null, 2));
    }
  }

  function handleJsonChange(raw: string) {
    setText(raw);
    const valid = validate(raw);
    if (valid) setPreview(valid);
  }

  function handleSave() {
    const valid = validate(text);
    if (valid) onSave(valid);
  }

  if (!open || !block) return null;

  const title = `Modifica blocco — ${TYPE_LABELS[block.type] ?? block.type}`;
  const hasVisualEditor = block.type === 'image_hotspot' || isFormEditable(block.type);

  return (
    <Dialog open={open} onClose={onClose} title={title} size="xl">
      <div className="grid max-h-[72vh] gap-5 overflow-hidden lg:grid-cols-[1fr_380px]">
        {/* Colonna editor (scrollabile) */}
        <div className="min-w-0 overflow-auto pr-1">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contenuto</p>

          {block.type === 'image_hotspot' ? (
            <ImageHotspotEditor block={block} onChange={applyPayload} />
          ) : isFormEditable(block.type) ? (
            <BlockFormEditor block={block} onChange={applyPayload} />
          ) : (
            <JsonEditor text={text} onChange={handleJsonChange} />
          )}

          {error && <p className="mt-2 text-xs text-destructive" data-testid="block-editor-error">{error}</p>}

          {/* Avanzato (JSON): sempre disponibile per i tipi con editor visuale. */}
          {hasVisualEditor && (
            <div className="mt-4 rounded-lg border">
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                aria-expanded={advancedOpen}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground"
              >
                <ChevronRight className={`size-4 transition-transform ${advancedOpen ? 'rotate-90' : ''}`} />
                Avanzato (JSON)
              </button>
              {advancedOpen && (
                <div className="border-t p-3">
                  <JsonEditor text={text} onChange={handleJsonChange} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Colonna anteprima (sticky) */}
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Anteprima</p>
          <div className="max-h-[62vh] overflow-auto rounded-lg border bg-muted/20 p-2">
            {preview ? <BlockRenderer block={preview} /> : <p className="text-xs text-muted-foreground">—</p>}
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2 border-t pt-4">
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Annulla
        </Button>
        <Button onClick={handleSave} disabled={saving || !!error}>
          {saving ? 'Salvataggio…' : 'Salva'}
        </Button>
      </div>
    </Dialog>
  );
}

/** Editor JSON grezzo (fallback / avanzato). */
function JsonEditor({ text, onChange }: { text: string; onChange: (raw: string) => void }) {
  return (
    <textarea
      value={text}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      className="h-72 w-full resize-y rounded-md border bg-background p-2 font-mono text-xs"
      aria-label="Struttura JSON del blocco"
    />
  );
}
