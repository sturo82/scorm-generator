'use client';

import * as React from 'react';
import { Upload, Plus, Trash2, Loader2, Video as VideoIcon, X, Youtube, Clapperboard, Download, Play, Camera, ImageUp, Pencil } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { SlideVideoDialog } from '@/components/courses/slide-video-dialog';
import {
  useVideos,
  useVideoChannels,
  useUploadVideoAsset,
  useCreateExternalVideo,
  useDeleteVideoAsset,
  useSetVideoThumbnail,
  useClearVideoThumbnail,
} from '@/lib/api/hooks';
import type { VideoAssetView } from '@/lib/api/types';

type SourceFilter = 'all' | 'upload' | 'youtube' | 'vimeo' | 'twitch';

const SOURCE_TABS: Array<{ id: SourceFilter; label: string }> = [
  { id: 'all', label: 'Tutti' },
  { id: 'upload', label: 'Caricati' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'vimeo', label: 'Vimeo' },
  { id: 'twitch', label: 'Twitch' },
];

const SOURCE_LABEL: Record<string, string> = {
  upload: 'Caricato',
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  twitch: 'Twitch',
};

export default function VideosPage() {
  const toast = useToast();
  const [source, setSource] = React.useState<SourceFilter>('all');
  const [channel, setChannel] = React.useState<string>('');
  const videos = useVideos({
    source: source === 'all' ? undefined : source,
    channel: channel || undefined,
  });
  const channels = useVideoChannels();
  const uploadVideo = useUploadVideoAsset();
  const createExternal = useCreateExternalVideo();
  const del = useDeleteVideoAsset();
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [externalOpen, setExternalOpen] = React.useState(false);
  const [slidesOpen, setSlidesOpen] = React.useState(false);
  // Import da riaprire (video creato da slide); null = nuovo video da slide.
  const [slidesImportId, setSlidesImportId] = React.useState<string | null>(null);
  const [playingId, setPlayingId] = React.useState<string | null>(null);
  const playing = videos.data?.find((v) => v.id === playingId) ?? null;

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    try {
      await uploadVideo.mutateAsync({ file });
      toast.show('Video caricato: trascrizione in corso', 'success');
    } catch (e) {
      toast.show(e instanceof Error ? cleanErr(e.message) : 'Upload non riuscito (max 200MB, MP4/WebM)', 'error');
    }
  }

  async function handleDelete(v: VideoAssetView) {
    if (!confirm(`Eliminare il video "${v.title}"?`)) return;
    try {
      await del.mutateAsync(v.id);
      toast.show('Video eliminato', 'success');
    } catch {
      toast.show('Eliminazione non riuscita', 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Video"
        description="Libreria video del tuo team: carica file o collega canali esterni (YouTube, Vimeo, Twitch)."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setSlidesImportId(null);
                setSlidesOpen(true);
              }}
            >
              <Clapperboard className="size-4" /> Crea da slide
            </Button>
            <Button variant="outline" onClick={() => setExternalOpen(true)}>
              <Youtube className="size-4" /> Aggiungi esterno
            </Button>
            <Button className="brand-glow" onClick={() => fileInput.current?.click()} disabled={uploadVideo.isPending}>
              {uploadVideo.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              Carica video
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="video/mp4,video/webm"
              className="hidden"
              onChange={(e) => {
                void handleUpload(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        }
      />

      <SlideVideoDialog
        courseId="library"
        libraryMode
        initialImportId={slidesImportId}
        open={slidesOpen}
        onClose={() => setSlidesOpen(false)}
      />
      {/* Tab sorgente + filtro canale */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border bg-card p-1" role="tablist">
          {SOURCE_TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={source === t.id}
              onClick={() => setSource(t.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                source === t.id ? 'bg-primary text-primary-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {(channels.data?.length ?? 0) > 0 && (
          <div className="flex items-center gap-2">
            <Label htmlFor="channel-filter" className="text-sm text-muted-foreground">Canale</Label>
            <Select id="channel-filter" value={channel} onChange={(e) => setChannel(e.target.value)} className="w-48">
              <option value="">Tutti i canali</option>
              {channels.data!.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {videos.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="p-0"><Skeleton className="aspect-video w-full" /></CardContent></Card>
          ))}
        </div>
      )}

      {videos.data && videos.data.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="brand-glow grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
              <VideoIcon className="size-7" />
            </div>
            <div>
              <p className="font-semibold">Nessun video</p>
              <p className="text-sm text-muted-foreground">Carica un file o collega un video da YouTube, Vimeo o Twitch.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {videos.data && videos.data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.data.map((v) => (
            <Card key={v.id} className="group overflow-hidden transition-all hover:border-primary/40 hover:shadow-elevate">
              <div className="relative aspect-video w-full bg-black">
                {v.source === 'upload' && v.url ? (
                  <button
                    type="button"
                    aria-label={`Riproduci ${v.title}`}
                    onClick={() => setPlayingId(v.id)}
                    className="group/play relative block size-full"
                  >
                    {v.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.thumbnailUrl} alt="" className="size-full object-cover" />
                    ) : (
                      // crossOrigin come nel player: stesso URL, e una risposta in cache senza intestazioni CORS
                      // verrebbe riusata dal player (che le richiede) facendolo fallire.
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <video src={`${v.url}#t=0.1`} crossOrigin="anonymous" preload="metadata" className="size-full object-contain" />
                    )}
                    <span className="absolute inset-0 grid place-items-center bg-black/10 transition-colors group-hover/play:bg-black/30">
                      <span className="grid size-12 place-items-center rounded-full bg-black/60 text-white">
                        <Play className="size-5 translate-x-0.5" />
                      </span>
                    </span>
                  </button>
                ) : v.url ? (
                  <a
                    href={v.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Apri ${v.title}`}
                    className="flex size-full items-center justify-center bg-gradient-to-br from-primary/10 to-accent/40"
                  >
                    <Play className="size-10 text-primary/60" />
                  </a>
                ) : (
                  <div className="flex size-full items-center justify-center bg-gradient-to-br from-primary/10 to-accent/40">
                    <VideoIcon className="size-10 text-primary/40" />
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  {SOURCE_LABEL[v.source] ?? v.source}
                </span>
              </div>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-sm font-semibold">{v.title}</p>
                  {v.slideImportId && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Modifica copioni, clip e montaggio"
                      title="Modifica copioni, clip e montaggio"
                      className="shrink-0 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                      onClick={() => {
                        setSlidesImportId(v.slideImportId);
                        setSlidesOpen(true);
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  )}
                  {v.downloadUrl && (
                    <a
                      href={v.downloadUrl}
                      aria-label="Scarica video"
                      title="Scarica video"
                      className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Download className="size-4" />
                    </a>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Elimina video"
                    className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => handleDelete(v)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                  {v.channel && <span className="rounded bg-accent px-1.5 py-0.5">{v.channel}</span>}
                  {v.source === 'upload' && <TranscriptBadge status={v.transcriptStatus} />}
                </div>
                {v.generationCost && (
                  <p
                    className="mt-1.5 text-xs text-muted-foreground"
                    title={
                      v.generationCost.sharedBy > 1
                        ? `Costo dell'intero import da slide, da cui sono nati ${v.generationCost.sharedBy} video.`
                        : 'Costo misurato della generazione (avatar, montaggio, testi AI), rigenerazioni comprese.'
                    }
                  >
                    Costo di generazione <strong className="text-foreground">{fmtUsd(v.generationCost.totalUsd)}</strong>
                    {v.generationCost.sharedBy > 1 ? ` (import di ${v.generationCost.sharedBy} video)` : ''}
                    {' · '}
                    {v.generationCost.breakdown.map((b) => `${b.label} ${fmtUsd(b.usd)}`).join(' · ')}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <VideoPlayerDialog video={playing} onClose={() => setPlayingId(null)} />
      <ExternalVideoDialog
        open={externalOpen}
        saving={createExternal.isPending}
        onClose={() => setExternalOpen(false)}
        onSubmit={async (input) => {
          try {
            await createExternal.mutateAsync(input);
            toast.show('Video esterno aggiunto', 'success');
            setExternalOpen(false);
          } catch (e) {
            toast.show(e instanceof Error ? cleanErr(e.message) : 'Operazione non riuscita', 'error');
          }
        }}
      />
    </>
  );
}

function VideoPlayerDialog({ video, onClose }: { video: VideoAssetView | null; onClose: () => void }) {
  const toast = useToast();
  const setThumb = useSetVideoThumbnail();
  const clearThumb = useClearVideoThumbnail();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const imageInput = React.useRef<HTMLInputElement>(null);
  const busy = setThumb.isPending || clearThumb.isPending;

  async function save(file: Blob | null) {
    if (!video || !file) return;
    try {
      await setThumb.mutateAsync({ id: video.id, file });
      toast.show('Anteprima aggiornata', 'success');
    } catch (e) {
      toast.show(e instanceof Error ? cleanErr(e.message) : 'Impostazione dell\u2019anteprima non riuscita', 'error');
    }
  }

  /** Usa il fotogramma mostrato adesso dal player come anteprima. */
  function captureFrame() {
    const el = videoRef.current;
    if (!el || !el.videoWidth) {
      toast.show('Il video non è ancora pronto', 'error');
      return;
    }
    el.pause();
    const scale = Math.min(1, 1280 / el.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(el.videoWidth * scale);
    canvas.height = Math.round(el.videoHeight * scale);
    try {
      canvas.getContext('2d')!.drawImage(el, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => void save(blob), 'image/jpeg', 0.9);
    } catch {
      toast.show('Non riesco a leggere il fotogramma: carica un\u2019immagine', 'error');
    }
  }

  return (
    <Dialog open={video !== null} onClose={onClose} title={video?.title ?? 'Video'} size="xl">
      {video && video.url && (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-lg bg-black">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={videoRef}
              key={video.id}
              src={video.url}
              poster={video.thumbnailUrl ?? undefined}
              crossOrigin="anonymous"
              controls
              autoPlay
              playsInline
              className="aspect-video max-h-[65vh] w-full object-contain"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Anteprima: metti in pausa sul fotogramma che preferisci, oppure carica un&apos;immagine.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={captureFrame} disabled={busy}>
                <Camera className="size-4" /> Usa questo fotogramma
              </Button>
              <Button variant="outline" size="sm" onClick={() => imageInput.current?.click()} disabled={busy}>
                <ImageUp className="size-4" /> Carica immagine
              </Button>
              {video.thumbnailUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => clearThumb.mutate(video.id, { onError: () => toast.show('Rimozione non riuscita', 'error') })}
                >
                  Rimuovi anteprima
                </Button>
              )}
              {video.downloadUrl && (
                <a
                  href={video.downloadUrl}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-accent"
                >
                  <Download className="size-4" /> Scarica
                </a>
              )}
            </div>
          </div>
          <input
            ref={imageInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              void save(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
        </div>
      )}
    </Dialog>
  );
}
function fmtUsd(v: number): string {
  return v > 0 && v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`;
}
function TranscriptBadge({ status }: { status: string }) {
  if (status === 'ready') return <span className="rounded bg-success/15 px-1.5 py-0.5 text-success">Trascrizione ✓</span>;
  if (status === 'processing') return <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-warning"><Loader2 className="size-3 animate-spin" /> Trascrizione…</span>;
  if (status === 'failed') return <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive">Trascrizione fallita</span>;
  return null;
}

function ExternalVideoDialog({
  open,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: { title: string; description: string; source: 'youtube' | 'vimeo' | 'twitch'; externalUrl: string; channel?: string }) => void;
}) {
  const [title, setTitle] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [src, setSrc] = React.useState<'youtube' | 'vimeo' | 'twitch'>('youtube');
  const [channel, setChannel] = React.useState('');

  React.useEffect(() => {
    if (open) { setTitle(''); setUrl(''); setSrc('youtube'); setChannel(''); }
  }, [open]);

  const valid = title.trim().length > 0 && /^https?:\/\//.test(url.trim());

  return (
    <Dialog open={open} onClose={onClose} title="Aggiungi video esterno">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit({ title: title.trim(), description: '', source: src, externalUrl: url.trim(), channel: channel.trim() || undefined });
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="ext-source">Piattaforma</Label>
          <Select id="ext-source" value={src} onChange={(e) => setSrc(e.target.value as typeof src)}>
            <option value="youtube">YouTube</option>
            <option value="vimeo">Vimeo</option>
            <option value="twitch">Twitch (video on-demand)</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ext-url">URL del video</Label>
          <Input id="ext-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" autoFocus />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ext-title">Titolo</Label>
          <Input id="ext-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titolo del video" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ext-channel">Canale (facoltativo)</Label>
          <Input id="ext-channel" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="Es. Canale aziendale" />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            <X className="size-4" /> Annulla
          </Button>
          <Button type="submit" disabled={!valid || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Aggiungi
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function cleanErr(msg: string): string {
  return msg.replace(/^API \d+:\s*/, '').slice(0, 160);
}
