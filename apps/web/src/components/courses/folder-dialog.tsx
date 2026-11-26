'use client';
import * as React from 'react';
import type { FolderView } from '@scorm/contracts';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { buildFolderTree } from '@/components/courses/folder-tree';

/** Risale la catena parentId per costruire il percorso (radice → cartella). */
export function folderPath(id: string, folders: FolderView[]): FolderView[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: FolderView[] = [];
  let cur: FolderView | undefined = byId.get(id);
  let guard = 0;
  while (cur && guard < 100) {
    out.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    guard++;
  }
  return out;
}

/** Opzioni piatte con indentazione per rappresentare la gerarchia nel select. */
export function flatOptions(folders: FolderView[]): Array<{ id: string; label: string }> {
  const tree = buildFolderTree(folders);
  const out: Array<{ id: string; label: string }> = [];
  const walk = (nodes: ReturnType<typeof buildFolderTree>, depth: number) => {
    for (const n of nodes) {
      out.push({ id: n.id, label: `${'\u00A0\u00A0'.repeat(depth)}${depth > 0 ? '└ ' : ''}${n.name}` });
      walk(n.children, depth + 1);
    }
  };
  walk(tree, 0);
  return out;
}

/** Dialog riutilizzabile per creare o rinominare una cartella. */
export function FolderDialog({
  state,
  folders,
  saving,
  onClose,
  onSubmit,
}: {
  state: { mode: 'create'; parentId: string | null } | { mode: 'rename'; folder: FolderView } | null;
  folders: FolderView[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (name: string, parentId: string | null) => void;
}) {
  const [name, setName] = React.useState('');
  const [parentId, setParentId] = React.useState<string>('');

  React.useEffect(() => {
    if (!state) return;
    if (state.mode === 'rename') {
      setName(state.folder.name);
      setParentId(state.folder.parentId ?? '');
    } else {
      setName('');
      setParentId(state.parentId ?? '');
    }
  }, [state]);

  const isRename = state?.mode === 'rename';
  return (
    <Dialog open={!!state} onClose={onClose} title={isRename ? 'Rinomina cartella' : 'Nuova cartella'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSubmit(name.trim(), isRename ? null : parentId || null);
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="folder-name">Nome</Label>
          <Input
            id="folder-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Es. Clienti, Onboarding…"
            maxLength={80}
          />
        </div>
        {!isRename && (
          <div className="space-y-1">
            <Label htmlFor="folder-parent">Cartella padre</Label>
            <Select id="folder-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">— Radice —</option>
              {flatOptions(folders).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annulla
          </Button>
          <Button type="submit" disabled={!name.trim() || saving}>
            {saving ? 'Salvataggio…' : isRename ? 'Rinomina' : 'Crea'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
