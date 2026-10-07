'use client';

import * as React from 'react';
import { ChevronRight, Folder as FolderIcon, FolderOpen, Layers, Pencil, Trash2 } from 'lucide-react';
import type { FolderView } from '@scorm/contracts';
import { cn } from '@/lib/cn';

/** Nodo dell'albero costruito dalla lista piatta di cartelle. */
export interface FolderNode extends FolderView {
  children: FolderNode[];
}

/** Costruisce l'albero (radici + figli) dalla lista piatta ordinata. */
export function buildFolderTree(folders: FolderView[]): FolderNode[] {
  const byId = new Map<string, FolderNode>();
  folders.forEach((f) => byId.set(f.id, { ...f, children: [] }));
  const roots: FolderNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

type Selection = { kind: 'all' } | { kind: 'root' } | { kind: 'folder'; id: string };

interface FolderTreeProps {
  folders: FolderView[];
  totalCount: number;
  rootCount: number;
  selected: Selection;
  onSelect: (sel: Selection) => void;
  onRename: (folder: FolderView) => void;
  onDelete: (folder: FolderView) => void;
}

/**
 * Navigatore ad albero delle cartelle, stile file-explorer enterprise. Mostra
 * «Tutti i corsi» e «Senza cartella» (radice) come voci speciali, poi l'albero
 * annidato con conteggi, espansione e azioni (rinomina/elimina) in hover.
 */
export function FolderTree({
  folders,
  totalCount,
  rootCount,
  selected,
  onSelect,
  onRename,
  onDelete,
}: FolderTreeProps) {
  const tree = React.useMemo(() => buildFolderTree(folders), [folders]);

  return (
    <nav aria-label="Cartelle" className="space-y-1">
      <SpecialRow
        icon={<Layers className="size-4" />}
        label="Tutti i corsi"
        count={totalCount}
        active={selected.kind === 'all'}
        onClick={() => onSelect({ kind: 'all' })}
      />
      <SpecialRow
        icon={<FolderIcon className="size-4" />}
        label="Senza cartella"
        count={rootCount}
        active={selected.kind === 'root'}
        onClick={() => onSelect({ kind: 'root' })}
      />
      {tree.length > 0 && <div className="my-2 h-px bg-border" />}
      <ul className="space-y-0.5">
        {tree.map((node) => (
          <FolderRow
            key={node.id}
            node={node}
            depth={0}
            selected={selected}
            onSelect={onSelect}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </nav>
  );
}

function SpecialRow({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition',
        active ? 'bg-primary/10 font-medium text-primary' : 'text-foreground hover:bg-accent/50',
      )}
    >
      <span className={active ? 'text-primary' : 'text-muted-foreground'}>{icon}</span>
      <span className="flex-1 truncate text-left">{label}</span>
      <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

function FolderRow({
  node,
  depth,
  selected,
  onSelect,
  onRename,
  onDelete,
}: {
  node: FolderNode;
  depth: number;
  selected: Selection;
  onSelect: (sel: Selection) => void;
  onRename: (folder: FolderView) => void;
  onDelete: (folder: FolderView) => void;
}) {
  const [open, setOpen] = React.useState(true);
  const isActive = selected.kind === 'folder' && selected.id === node.id;
  const hasChildren = node.children.length > 0;

  return (
    <li>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-lg pr-1 transition',
          isActive ? 'bg-primary/10' : 'hover:bg-accent/50',
        )}
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        <button
          type="button"
          aria-label={open ? 'Comprimi' : 'Espandi'}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition',
            !hasChildren && 'invisible',
          )}
        >
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        </button>
        <button
          type="button"
          onClick={() => onSelect({ kind: 'folder', id: node.id })}
          aria-current={isActive ? 'true' : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm"
        >
          <span className={isActive ? 'text-primary' : 'text-muted-foreground'}>
            {isActive || open ? <FolderOpen className="size-4" /> : <FolderIcon className="size-4" />}
          </span>
          <span className={cn('flex-1 truncate', isActive && 'font-medium text-primary')}>
            {node.name}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">{node.courseCount}</span>
        </button>
        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            aria-label={`Rinomina ${node.name}`}
            onClick={() => onRename(node)}
            className="grid size-7 place-items-center rounded text-muted-foreground hover:text-foreground"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Elimina ${node.name}`}
            onClick={() => onDelete(node)}
            className="grid size-7 place-items-center rounded text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
      {hasChildren && open && (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <FolderRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
