'use client';

import * as React from 'react';
import Link from 'next/link';
import { FolderPlus, Plus, Search, Trash2, FolderInput, X, ChevronRight, FolderOpen, BookOpen } from 'lucide-react';
import type { FolderView } from '@scorm/contracts';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EditorialStatusBadge } from '@/components/status-badge';
import { useToast } from '@/components/ui/toast';
import {
  useCourses,
  useDeleteCourse,
  useFolders,
  useCreateFolder,
  useUpdateFolder,
  useDeleteFolder,
  useMoveCourse,
  useActiveCourseJobs,
} from '@/lib/api/hooks';
import { GeneratingBadge } from '@/components/courses/generating-badge';
import { FolderTree, buildFolderTree } from '@/components/courses/folder-tree';

type Selection = { kind: 'all' } | { kind: 'root' } | { kind: 'folder'; id: string };

export default function CoursesPage() {
  const [selected, setSelected] = React.useState<Selection>({ kind: 'all' });
  const [search, setSearch] = React.useState('');
  const q = search.trim();

  // Elenco corsi: in ricerca ignora la cartella (cross-folder); altrimenti filtra.
  const folderFilter = q
    ? undefined
    : selected.kind === 'all'
      ? undefined
      : selected.kind === 'root'
        ? 'root'
        : selected.id;
  const courses = useCourses({ folderId: folderFilter, q: q || undefined });
  // Totali per i contatori della sidebar (indipendenti dal filtro corrente).
  const allCourses = useCourses();
  const folders = useFolders();
  // Corsi con generazione attiva (badge "in generazione"), polling tenant-wide.
  const activeJobs = useActiveCourseJobs();
  const generatingIds = React.useMemo(
    () => new Set((activeJobs.data ?? []).map((a) => a.courseId)),
    [activeJobs.data],
  );

  // Sottocartelle del contesto corrente: mostrate come card inline nella
  // griglia prima dei corsi, così l'utente può navigare con doppio click.
  // In ricerca attiva o "tutti i corsi" non mostriamo le cartelle inline.
  const subfolders = React.useMemo(() => {
    if (q || !folders.data) return [];
    const parentId =
      selected.kind === 'folder' ? selected.id :
      selected.kind === 'root' ? null : null;
    // "Tutti i corsi" mostra le radici; "Senza cartella" e "folder" mostrano
    // le cartelle con parentId corrispondente.
    if (selected.kind === 'all') {
      // Radici
      return (folders.data ?? []).filter((f) => !f.parentId).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    }
    return (folders.data ?? []).filter((f) => f.parentId === parentId).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  }, [folders.data, selected, q]);

  const del = useDeleteCourse();
  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();
  const deleteFolder = useDeleteFolder();
  const moveCourse = useMoveCourse();
  const toast = useToast();

  const [folderDialog, setFolderDialog] = React.useState<
    { mode: 'create'; parentId: string | null } | { mode: 'rename'; folder: FolderView } | null
  >(null);
  const [moveTarget, setMoveTarget] = React.useState<{ id: string; title: string; folderId: string | null } | null>(null);

  const totalCount = allCourses.data?.length ?? 0;
  const rootCount = allCourses.data?.filter((c) => !c.folderId).length ?? 0;
  const folderName = (id: string) => folders.data?.find((f) => f.id === id)?.name ?? 'Cartella';

  async function handleDelete(id: string, title: string) {
    if (!confirm(`Eliminare il corso "${title}"? L'operazione non è reversibile.`)) return;
    try {
      await del.mutateAsync(id);
      toast.show('Corso eliminato', 'success');
    } catch {
      toast.show('Eliminazione non riuscita', 'error');
    }
  }

  async function handleDeleteFolder(folder: FolderView) {
    if (
      !confirm(
        `Eliminare la cartella "${folder.name}"? I corsi e le sottocartelle NON vengono eliminati: torneranno fuori dalla cartella.`,
      )
    )
      return;
    try {
      await deleteFolder.mutateAsync(folder.id);
      if (selected.kind === 'folder' && selected.id === folder.id) setSelected({ kind: 'all' });
      toast.show('Cartella eliminata', 'success');
    } catch {
      toast.show('Eliminazione cartella non riuscita', 'error');
    }
  }

  async function handleMove(folderId: string | null) {
    if (!moveTarget) return;
    try {
      await moveCourse.mutateAsync({ courseId: moveTarget.id, folderId });
      toast.show(folderId ? `Spostato in «${folderName(folderId)}»` : 'Spostato fuori dalle cartelle', 'success');
      setMoveTarget(null);
    } catch {
      toast.show('Spostamento non riuscito', 'error');
    }
  }

  const title =
    q
      ? `Risultati per «${q}»`
      : selected.kind === 'all'
        ? 'Tutti i corsi'
        : selected.kind === 'root'
          ? 'Senza cartella'
          : folderName(selected.id);

  return (
    <>
      <PageHeader
        title="Corsi"
        description="Organizza i corsi in cartelle e trovali con la ricerca."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setFolderDialog({ mode: 'create', parentId: currentFolderId(selected) })}>
              <FolderPlus className="size-4" /> Nuova cartella
            </Button>
            <Button asChild>
              <Link href="/courses/new">
                <Plus className="size-4" /> Nuovo corso
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Sidebar cartelle */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-xl border bg-card p-3">
            {folders.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-3/4" />
              </div>
            ) : (
              <FolderTree
                folders={folders.data ?? []}
                totalCount={totalCount}
                rootCount={rootCount}
                selected={selected}
                onSelect={setSelected}
                onRename={(folder) => setFolderDialog({ mode: 'rename', folder })}
                onDelete={handleDeleteFolder}
              />
            )}
          </div>
        </aside>

        {/* Colonna principale */}
        <section className="space-y-4">
          {/* Barra ricerca + breadcrumb/titolo contesto */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {selected.kind === 'folder' && !q ? (
              <nav aria-label="Percorso cartelle" className="flex flex-wrap items-center gap-1 text-sm">
                <button
                  type="button"
                  onClick={() => setSelected({ kind: 'all' })}
                  className="font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Tutti i corsi
                </button>
                {folderPath(selected.id, folders.data ?? []).map((f, i, arr) => (
                  <span key={f.id} className="flex items-center gap-1">
                    <ChevronRight className="size-3.5 text-muted-foreground" />
                    <button
                      type="button"
                      onClick={() => setSelected({ kind: 'folder', id: f.id })}
                      className={
                        i === arr.length - 1
                          ? 'font-semibold text-foreground'
                          : 'font-medium text-muted-foreground transition-colors hover:text-foreground'
                      }
                      aria-current={i === arr.length - 1 ? 'page' : undefined}
                    >
                      {f.name}
                    </button>
                  </span>
                ))}
              </nav>
            ) : (
              <h2 className="text-base font-semibold">{title}</h2>
            )}
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cerca corsi…"
                className="pl-9 pr-9"
                aria-label="Cerca corsi"
              />
              {search && (
                <button
                  type="button"
                  aria-label="Cancella ricerca"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          </div>

          {courses.isLoading && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-1/2" />
                  </CardHeader>
                </Card>
              ))}
            </div>
          )}

          {courses.data && courses.data.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="py-14 text-center text-muted-foreground">
                {q
                  ? 'Nessun corso corrisponde alla ricerca.'
                  : selected.kind === 'folder'
                    ? 'Questa cartella è vuota. Sposta qui dei corsi o creane di nuovi.'
                    : 'Nessun corso. Creane uno nuovo per iniziare.'}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {/* Card cartella inline: doppio click → entra nella cartella. */}
            {subfolders.map((f) => (
              <Card
                key={`folder-${f.id}`}
                className="group relative h-full cursor-pointer overflow-hidden border-dashed transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elevate"
                onDoubleClick={() => setSelected({ kind: 'folder', id: f.id })}
                role="button"
                tabIndex={0}
                aria-label={`Cartella ${f.name} — doppio click per entrare`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setSelected({ kind: 'folder', id: f.id });
                }}
              >
                {/* Banner gradiente brand */}
                <div className="flex aspect-[16/9] items-center justify-center bg-gradient-to-br from-accent to-accent/40">
                  <FolderOpen className="size-12 text-primary/40" />
                </div>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 line-clamp-2">
                      <FolderOpen className="size-4 shrink-0 text-primary" />
                      {f.name}
                    </CardTitle>
                    <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                      {f.courseCount} {f.courseCount === 1 ? 'corso' : 'corsi'}
                    </span>
                  </div>
                </CardHeader>
              </Card>
            ))}

            {/* Card corsi */}
            {courses.data?.map((c) => (
              <Card key={c.id} className="group relative h-full overflow-hidden transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elevate">
                <Link href={`/courses/${c.id}`} className="block">
                  {c.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- URL firmato dinamico (no next/image)
                    <img
                      src={c.coverImageUrl}
                      alt={`Copertina: ${c.title}`}
                      className="aspect-[16/9] w-full object-cover"
                    />
                  ) : (
                    /* Placeholder copertina: gradiente brand + icona, così la card
                       ha sempre la stessa altezza e un aspetto curato. */
                    <div className="flex aspect-[16/9] items-center justify-center bg-gradient-to-br from-primary/10 via-accent/60 to-primary/5">
                      <BookOpen className="size-10 text-primary/30" />
                    </div>
                  )}
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="line-clamp-2">{c.title}</CardTitle>
                      <EditorialStatusBadge status={c.status} />
                    </div>
                    {generatingIds.has(c.id) && <GeneratingBadge className="mt-1 w-fit" />}
                    <CardDescription className="line-clamp-2">
                      {c.description || 'Nessuna descrizione'}
                    </CardDescription>
                  </CardHeader>
                </Link>
                <CardContent className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">{c.language}</span>
                    {/* Quando si cerca, mostra dove si trova il corso. */}
                    {q && c.folderId && (
                      <span className="rounded bg-accent px-1.5 py-0.5 text-xs text-muted-foreground">
                        {folderName(c.folderId)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Sposta in cartella"
                      className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => setMoveTarget({ id: c.id, title: c.title, folderId: c.folderId ?? null })}
                    >
                      <FolderInput className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Elimina corso"
                      className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => handleDelete(c.id, c.title)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </div>

      {/* Dialog crea/rinomina cartella */}
      <FolderDialog
        state={folderDialog}
        folders={folders.data ?? []}
        saving={createFolder.isPending || updateFolder.isPending}
        onClose={() => setFolderDialog(null)}
        onSubmit={async (name, parentId) => {
          try {
            if (folderDialog?.mode === 'rename') {
              await updateFolder.mutateAsync({ id: folderDialog.folder.id, name });
              toast.show('Cartella rinominata', 'success');
            } else {
              await createFolder.mutateAsync({ name, parentId });
              toast.show('Cartella creata', 'success');
            }
            setFolderDialog(null);
          } catch (e) {
            toast.show(e instanceof Error ? cleanErr(e.message) : 'Operazione non riuscita', 'error');
          }
        }}
      />

      {/* Dialog sposta corso */}
      <Dialog open={!!moveTarget} onClose={() => setMoveTarget(null)} title="Sposta corso in cartella">
        {moveTarget && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Scegli la cartella di destinazione per «{moveTarget.title}».
            </p>
            <div className="space-y-1">
              <Label htmlFor="move-folder">Cartella</Label>
              <Select
                id="move-folder"
                defaultValue={moveTarget.folderId ?? ''}
                onChange={(e) => void handleMove(e.target.value || null)}
              >
                <option value="">— Nessuna cartella (radice) —</option>
                {flatOptions(folders.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

function currentFolderId(sel: Selection): string | null {
  return sel.kind === 'folder' ? sel.id : null;
}

/** Risale la catena parentId per costruire il percorso (radice → cartella). */
function folderPath(id: string, folders: FolderView[]): FolderView[] {
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

/** Rende leggibile un errore del backend (toglie prefissi tecnici). */
function cleanErr(msg: string): string {
  return msg.replace(/^API \d+:\s*/, '').slice(0, 160);
}

/** Opzioni piatte con indentazione per rappresentare la gerarchia nel select. */
function flatOptions(folders: FolderView[]): Array<{ id: string; label: string }> {
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
function FolderDialog({
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
