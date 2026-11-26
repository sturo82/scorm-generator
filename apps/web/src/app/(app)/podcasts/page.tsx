'use client';
import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, FolderInput, FolderOpen, FolderPlus, Globe, Lock, Mic, Plus, Search, X } from 'lucide-react';
import type { FolderView } from '@scorm/contracts';
import { PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { FolderDialog, flatOptions, folderPath } from '@/components/courses/folder-dialog';
import { FolderTree } from '@/components/courses/folder-tree';
import { PODCAST_LANGUAGES } from '@/components/podcasts/podcast-labels';
import { useCreateFolder, useDeleteFolder, useFolders, useMovePodcast, usePodcasts, useUpdateFolder } from '@/lib/api/hooks';

type Selection = { kind: 'all' } | { kind: 'root' } | { kind: 'folder'; id: string };

export default function PodcastsPage() {
  const podcasts = usePodcasts();
  const folders = useFolders('PODCAST');
  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();
  const deleteFolder = useDeleteFolder();
  const movePodcast = useMovePodcast();
  const toast = useToast();

  const [selected, setSelected] = React.useState<Selection>({ kind: 'all' });
  const [search, setSearch] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [folderDialog, setFolderDialog] = React.useState<
    { mode: 'create'; parentId: string | null } | { mode: 'rename'; folder: FolderView } | null
  >(null);
  const [moveTarget, setMoveTarget] = React.useState<{ id: string; title: string; folderId: string | null } | null>(null);

  const all = React.useMemo(() => podcasts.data ?? [], [podcasts.data]);
  const q = search.trim().toLowerCase();
  const folderList = React.useMemo(() => folders.data ?? [], [folders.data]);
  const folderName = (id: string) => folderList.find((f) => f.id === id)?.name ?? 'Cartella';

  const categories = React.useMemo(() => Array.from(new Set(all.map((p) => p.category))).sort(), [all]);

  const list = React.useMemo(
    () =>
      all.filter((p) => {
        // In ricerca si cerca in tutte le cartelle.
        if (!q) {
          if (selected.kind === 'root' && p.folderId) return false;
          if (selected.kind === 'folder' && p.folderId !== selected.id) return false;
        }
        if (category && p.category !== category) return false;
        if (!q) return true;
        return [p.title, p.description, p.author ?? '', ...p.hostNames].some((t) => t.toLowerCase().includes(q));
      }),
    [all, q, selected, category],
  );

  // Sottocartelle del contesto corrente, mostrate come righe prima delle serie.
  const subfolders = React.useMemo(() => {
    if (q) return [];
    const parentId = selected.kind === 'folder' ? selected.id : null;
    if (selected.kind === 'root') return [];
    return folderList.filter((f) => f.parentId === parentId).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  }, [folderList, selected, q]);

  const title = q
    ? `Risultati per «${search.trim()}»`
    : selected.kind === 'all'
      ? 'Tutti i podcast'
      : selected.kind === 'root'
        ? 'Senza cartella'
        : folderName(selected.id);

  async function handleDeleteFolder(folder: FolderView) {
    if (!confirm(`Eliminare la cartella "${folder.name}"? I podcast e le sottocartelle NON vengono eliminati: tornano fuori dalla cartella.`)) return;
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
      await movePodcast.mutateAsync({ podcastId: moveTarget.id, folderId });
      toast.show(folderId ? `Spostato in «${folderName(folderId)}»` : 'Spostato fuori dalle cartelle', 'success');
      setMoveTarget(null);
    } catch {
      toast.show('Spostamento non riuscito', 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Podcast"
        description="Le tue serie audio con due conduttori. Organizzale in cartelle e trovale con la ricerca."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setFolderDialog({ mode: 'create', parentId: selected.kind === 'folder' ? selected.id : null })}
            >
              <FolderPlus className="size-4" /> Nuova cartella
            </Button>
            <Button asChild>
              <Link href={selected.kind === 'folder' ? `/podcasts/new?folder=${selected.id}` : '/podcasts/new'}>
                <Plus className="size-4" /> Nuovo podcast
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-xl border bg-card p-3">
            {folders.isLoading || podcasts.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-3/4" />
              </div>
            ) : (
              <FolderTree
                folders={folderList}
                totalCount={all.length}
                rootCount={all.filter((p) => !p.folderId).length}
                selected={selected}
                onSelect={setSelected}
                onRename={(folder) => setFolderDialog({ mode: 'rename', folder })}
                onDelete={handleDeleteFolder}
                allLabel="Tutti i podcast"
              />
            )}
          </div>
        </aside>

        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {selected.kind === 'folder' && !q ? (
              <nav aria-label="Percorso cartelle" className="flex flex-wrap items-center gap-1 text-sm">
                <button type="button" onClick={() => setSelected({ kind: 'all' })} className="font-medium text-muted-foreground transition-colors hover:text-foreground">
                  Tutti i podcast
                </button>
                {folderPath(selected.id, folderList).map((f, i, arr) => (
                  <span key={f.id} className="flex items-center gap-1">
                    <ChevronRight className="size-3.5 text-muted-foreground" />
                    <button
                      type="button"
                      onClick={() => setSelected({ kind: 'folder', id: f.id })}
                      className={i === arr.length - 1 ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground transition-colors hover:text-foreground'}
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
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {categories.length > 1 && (
                <Select aria-label="Filtra per categoria" value={category} onChange={(e) => setCategory(e.target.value)} className="sm:w-48">
                  <option value="">Tutte le categorie</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              )}
              <div className="relative sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca per titolo, conduttore, tema…" className="pl-9 pr-9" aria-label="Cerca podcast" />
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
          </div>

          {podcasts.isLoading && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Card key={i} className="overflow-hidden">
                  <Skeleton className="aspect-[16/9] w-full" />
                  <div className="space-y-2 p-4">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </Card>
              ))}
            </div>
          )}
          {podcasts.isError && <p className="text-sm text-destructive">Non riesco a leggere i podcast. Riprova tra poco.</p>}

          {subfolders.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {subfolders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelected({ kind: 'folder', id: f.id })}
                  aria-label={`Cartella ${f.name}: apri`}
                  className="group flex items-center gap-3 rounded-lg border border-dashed bg-muted/30 px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                    <FolderOpen className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{f.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {f.courseCount} podcast
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </button>
              ))}
            </div>
          )}

          {!podcasts.isLoading && !podcasts.isError && list.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
                <Mic className="size-8 text-muted-foreground" aria-hidden />
                {all.length === 0 ? (
                  <>
                    <p className="font-medium">Non hai ancora nessun podcast</p>
                    <p className="max-w-md text-sm text-muted-foreground">
                      Crea la serie con titolo, copertina e conduttori. Le puntate le aggiungi quando vuoi, una alla volta.
                    </p>
                    <Button asChild>
                      <Link href="/podcasts/new">
                        <Plus className="size-4" /> Crea il primo podcast
                      </Link>
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {q || category ? 'Nessun podcast corrisponde alla ricerca.' : 'Questa cartella non contiene podcast. Spostane qui o creane di nuovi.'}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((p) => {
              const lang = PODCAST_LANGUAGES.find((l) => l.code === p.language.slice(0, 2))?.label ?? p.language;
              return (
                <Card key={p.id} className="group relative flex h-full flex-col overflow-hidden transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elevate">
                  <Link href={`/podcasts/serie?id=${p.id}`} className="flex flex-1 flex-col">
                    <div className="relative aspect-[16/9] w-full overflow-hidden bg-gradient-to-br from-primary/20 via-primary/10 to-muted">
                      {p.coverUrl ? (
                        <>
                          {/* Sfondo sfocato + copertina quadrata intera, senza tagli. */}
                          {/* eslint-disable-next-line @next/next/no-img-element -- URL firmato dinamico (no next/image) */}
                          <img src={p.coverUrl} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover opacity-60 blur-xl" />
                          {/* eslint-disable-next-line @next/next/no-img-element -- URL firmato dinamico (no next/image) */}
                          <img src={p.coverUrl} alt={`Copertina: ${p.title}`} className="relative mx-auto h-full w-auto max-w-full object-contain shadow-lg" />
                        </>
                      ) : (
                        <div className="grid size-full place-items-center">
                          <Mic className="size-10 text-primary/60" aria-hidden />
                        </div>
                      )}
                      <Badge variant={p.visibility === 'PUBLIC' ? 'success' : 'secondary'} className="absolute left-3 top-3 gap-1">
                        {p.visibility === 'PUBLIC' ? <Globe className="size-3" aria-hidden /> : <Lock className="size-3" aria-hidden />}
                        {p.visibility === 'PUBLIC' ? 'Pubblico' : 'Privato'}
                      </Badge>
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-4">
                      <h3 className="line-clamp-2 font-semibold leading-snug">{p.title}</h3>
                      {p.description ? (
                        <p className="line-clamp-2 text-sm text-muted-foreground">{p.description}</p>
                      ) : (
                        <p className="text-sm italic text-muted-foreground">Nessuna descrizione</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {p.hostNames.length > 0 ? `Con ${p.hostNames.join(' e ')}` : p.author ? `Di ${p.author}` : ''}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline">{p.category}</Badge>
                        <Badge variant="outline">{lang}</Badge>
                        {q && p.folderId && <Badge variant="secondary">{folderName(p.folderId)}</Badge>}
                      </div>
                      <div className="mt-auto grid grid-cols-3 gap-2 border-t pt-3 text-center">
                        <Stat value={p.episodeCount} label={p.episodeCount === 1 ? 'puntata' : 'puntate'} />
                        <Stat value={p.readyCount} label="con audio" />
                        <Stat value={p.publishedCount} label="pubblicate" />
                      </div>
                    </div>
                  </Link>
                  <button
                    type="button"
                    aria-label={`Sposta «${p.title}» in una cartella`}
                    onClick={() => setMoveTarget({ id: p.id, title: p.title, folderId: p.folderId })}
                    className="absolute right-3 top-3 grid size-8 place-items-center rounded-md bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <FolderInput className="size-4" />
                  </button>
                </Card>
              );
            })}
          </div>
        </section>
      </div>

      <FolderDialog
        state={folderDialog}
        folders={folderList}
        saving={createFolder.isPending || updateFolder.isPending}
        onClose={() => setFolderDialog(null)}
        onSubmit={async (name, parentId) => {
          try {
            if (folderDialog?.mode === 'rename') {
              await updateFolder.mutateAsync({ id: folderDialog.folder.id, name });
              toast.show('Cartella rinominata', 'success');
            } else {
              await createFolder.mutateAsync({ name, parentId, kind: 'PODCAST' });
              toast.show('Cartella creata', 'success');
            }
            setFolderDialog(null);
          } catch (e) {
            toast.show(e instanceof Error ? e.message.replace(/^API \d+:\s*/, '').slice(0, 160) : 'Operazione non riuscita', 'error');
          }
        }}
      />

      <Dialog open={!!moveTarget} onClose={() => setMoveTarget(null)} title="Sposta podcast in cartella">
        {moveTarget && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Scegli la cartella di destinazione per «{moveTarget.title}».</p>
            <div className="space-y-1">
              <Label htmlFor="move-podcast-folder">Cartella</Label>
              <Select id="move-podcast-folder" defaultValue={moveTarget.folderId ?? ''} onChange={(e) => void handleMove(e.target.value || null)}>
                <option value="">— Nessuna cartella (radice) —</option>
                {flatOptions(folderList).map((o) => (
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

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
