'use client';

import * as React from 'react';
import { Block } from '@scorm/contracts';
import type { Block as BlockType } from '@scorm/contracts';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { BlockRenderer } from '@/components/courses/block-renderer';
import { ImageHotspotEditor } from '@/components/courses/image-hotspot-editor';

/**
 * Editor di un singolo Block. Per coprire tutti gli 11 tipi in modo affidabile,
 * si edita il JSON del block validato con lo schema Zod `Block` (nessuna
 * struttura non valida può essere salvata), con anteprima live del risultato.
 * Form visuali per-tipo potranno sostituire questo editor in futuro.
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

  React.useEffect(() => {
    if (block) {
      setText(JSON.stringify(block, null, 2));
      setPreview(block);
      setError(null);
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

  function handlePreview() {
    const valid = validate(text);
    if (valid) setPreview(valid);
  }

  function handleSave() {
    const valid = validate(text);
    if (valid) onSave(valid);
  }

  // Applica un payload strutturato (dagli editor visuali) al block, validandolo.
  function applyPayload(payload: Record<string, unknown>) {
    if (!block) return;
    const candidate = { ...block, payload } as unknown;
    const result = Block.safeParse(candidate);
    if (result.success) {
      setPreview(result.data);
      setText(JSON.stringify(result.data, null, 2));
      setError(null);
    } else {
      // Mostra il primo errore ma aggiorna comunque il testo JSON (così l'utente
      // può correggere): es. image mancante o nessun hotspot.
      const first = result.error.issues[0];
      setError(first ? `${first.path.join('.')} — ${first.message}` : 'struttura non valida');
      setText(JSON.stringify(candidate, null, 2));
    }
  }

  if (!open || !block) return null;

  // Editor VISUALE dedicato per image_hotspot (immagine + pallini), con
  // anteprima live. Gli altri tipi usano l'editor JSON generico sotto.
  if (block.type === 'image_hotspot') {
    return (
      <Dialog open={open} onClose={onClose} title="Modifica block — immagine interattiva">
        <div className="grid max-h-[70vh] gap-4 overflow-auto md:grid-cols-2">
          <div className="overflow-auto">
            <ImageHotspotEditor block={block} onChange={applyPayload} />
            {error && <p className="mt-2 text-xs text-destructive" data-testid="block-editor-error">{error}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-muted-foreground">Anteprima</label>
            <div className="h-80 overflow-auto rounded-md border bg-muted/30 p-2">
              {preview ? <BlockRenderer block={preview} /> : <p className="text-xs text-muted-foreground">—</p>}
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
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

  return (
    <Dialog open={open} onClose={onClose} title={`Modifica block — ${block.type}`}>
      <div className="grid max-h-[70vh] gap-4 overflow-auto md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-muted-foreground">Struttura (JSON)</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            className="h-80 w-full resize-none rounded-md border bg-background p-2 font-mono text-xs"
          />
          {error && <p className="text-xs text-destructive" data-testid="block-editor-error">{error}</p>}
          <Button type="button" variant="outline" size="sm" onClick={handlePreview}>
            Aggiorna anteprima
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-muted-foreground">Anteprima</label>
          <div className="h-80 overflow-auto rounded-md border bg-muted/30 p-2">
            {preview ? <BlockRenderer block={preview} /> : <p className="text-xs text-muted-foreground">—</p>}
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
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
