'use client';

import type { Block } from '@scorm/contracts';
import { Badge } from '@/components/ui/badge';

interface MediaLike {
  kind?: 'image' | 'video' | 'audio';
  storageKey?: string;
  alt?: string;
  placeholderPrompt?: string;
}

/**
 * Mostra le immagini di un elenco di MediaRef. L'API risolve `storageKey` in URL
 * firmato in lettura: se presente mostriamo l'immagine, altrimenti un
 * placeholder con il prompt descrittivo (immagine non ancora materializzata).
 */
function MediaImages({ media }: { media?: MediaLike[] }) {
  const images = (media ?? []).filter((m) => (m.kind ?? 'image') === 'image');
  if (images.length === 0) return null;
  return (
    <>
      {images.map((m, i) =>
        m.storageKey ? (
          <figure key={m.storageKey ?? i} className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element -- URL dinamico da storage, anteprima editoriale */}
            <img src={m.storageKey} alt={m.alt ?? ''} className="block w-full max-w-md rounded border" />
            {m.alt ? <figcaption className="mt-1 text-xs text-muted-foreground">{m.alt}</figcaption> : null}
          </figure>
        ) : (
          <div
            key={i}
            className="grid aspect-video w-full max-w-md place-items-center rounded border border-dashed bg-muted/40 p-2 text-center text-xs text-muted-foreground"
          >
            {m.placeholderPrompt ? `Immagine: ${m.placeholderPrompt}` : 'Immagine (placeholder)'}
          </div>
        ),
      )}
    </>
  );
}

/**
 * Nota di stato della trascrizione sotto il video. Mostra l'elaborazione in
 * corso, l'esito positivo, oppure il motivo del fallimento con un invito a
 * inserire la trascrizione manualmente (apre l'editor dedicato).
 */
function TranscriptStatusNote({
  status,
  error,
  onEdit,
}: {
  status: string;
  error?: string;
  onEdit?: () => void;
}) {
  if (status === 'processing') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="inline-block size-2 animate-pulse rounded-full bg-amber-500" />
        Trascrizione in elaborazione…
      </p>
    );
  }
  if (status === 'ready') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-600">
        <span className="inline-block size-2 rounded-full bg-emerald-500" />
        Trascrizione pronta
      </p>
    );
  }
  if (status === 'failed') {
    return (
      <div className="rounded-md border border-amber-300/60 bg-amber-50 p-2.5 text-xs text-amber-900">
        <p className="font-medium">Trascrizione automatica non riuscita</p>
        <p className="mt-0.5 text-amber-800">
          {error || 'Non è stato possibile trascrivere il video. Puoi inserire la trascrizione manualmente.'}
        </p>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="mt-1.5 font-semibold text-primary hover:underline"
          >
            Inserisci la trascrizione manualmente
          </button>
        )}
      </div>
    );
  }
  // status 'none': nessuna nota (il video può non avere trascrizione per scelta).
  return null;
}

const TYPE_LABELS: Record<string, string> = {
  rich_text: 'Testo',
  image_hotspot: 'Immagine interattiva',
  accordion_tabs: 'Accordion/Tabs',
  flashcard: 'Flashcard',
  timeline: 'Timeline',
  dragdrop_match: 'Abbinamento',
  dragdrop_order: 'Ordinamento',
  click_reveal: 'Click to reveal',
  branching_scenario: 'Scenario',
  video_checkpoint: 'Video',
  carousel_steps: 'Step-by-step',
};

/**
 * Anteprima leggibile di un Block nell'editor. Per il rich_text mostra l'HTML
 * (già sanificato lato server in export); per gli altri tipi un riassunto
 * strutturato. Non è il renderer SCORM runtime, ma una vista editoriale.
 */
export function BlockPreview({
  block,
  onUploadVideo,
  onEditTranscript,
}: {
  block: Block;
  /** Callback per avviare l'upload video (solo per block video_checkpoint senza video). */
  onUploadVideo?: (blockId: string) => void;
  /** Callback per aprire l'editor della trascrizione manuale (block video). */
  onEditTranscript?: (blockId: string) => void;
}) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="secondary">{TYPE_LABELS[block.type] ?? block.type}</Badge>
      </div>
      {renderBody(block, onUploadVideo, onEditTranscript)}
    </div>
  );
}

function renderBody(
  block: Block,
  onUploadVideo?: (blockId: string) => void,
  onEditTranscript?: (blockId: string) => void,
) {
  const p = block.payload as Record<string, unknown>;
  switch (block.type) {
    case 'rich_text': {
      const html = (p.content as { html?: string })?.html ?? '';
      const media = (p.media as MediaLike[]) ?? [];
      return (
        <div className="space-y-3">
          <div
            className="max-w-none text-sm text-foreground [&_p]:my-1"
            dangerouslySetInnerHTML={{ __html: html }}
          />
          <MediaImages media={media} />
        </div>
      );
    }
    case 'carousel_steps': {
      const steps = (p.steps as Array<{ id: string; title: string; content?: { html?: string }; media?: MediaLike }>) ?? [];
      return (
        <ol className="space-y-3 text-sm">
          {steps.map((s) => (
            <li key={s.id} className="space-y-1">
              <p className="font-medium">{s.title}</p>
              {s.media ? <MediaImages media={[s.media]} /> : null}
              {s.content?.html ? (
                <div
                  className="max-w-none text-muted-foreground [&_p]:my-1"
                  dangerouslySetInnerHTML={{ __html: s.content.html }}
                />
              ) : null}
            </li>
          ))}
        </ol>
      );
    }
    case 'flashcard':
      return (
        <ul className="space-y-1 text-sm">
          {((p.cards as Array<{ id: string; front: { html: string } }>) ?? []).map((c) => (
            <li key={c.id} className="text-muted-foreground">
              Carta: <span dangerouslySetInnerHTML={{ __html: c.front.html }} />
            </li>
          ))}
        </ul>
      );
    case 'accordion_tabs':
      return (
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {((p.panels as Array<{ id: string; title: string }>) ?? []).map((pan) => (
            <li key={pan.id}>{pan.title}</li>
          ))}
        </ul>
      );
    case 'video_checkpoint': {
      const video = (p.video as { storageKey?: string; alt?: string; placeholderPrompt?: string }) ?? {};
      const hasVideo = Boolean(video.storageKey);
      const transcriptStatus = (p.transcriptStatus as string) ?? 'none';
      const transcriptError = (p.transcriptError as string) ?? '';
      // storageKey è risolto in URL firmato dall'API: usabile come src video.
      const videoUrl = video.storageKey ?? '';
      const videoFilename = hasVideo
        ? decodeURIComponent(videoUrl.split('?')[0]?.split('/').pop() ?? 'video')
        : '';
      return (
        <div className="space-y-2">
          {hasVideo ? (
            <div className="overflow-hidden rounded-lg border border-primary/20">
              {/* Player inline: l'utente vede subito il video caricato. */}
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                controls
                preload="metadata"
                src={videoUrl}
                className="aspect-video w-full max-w-md bg-black object-contain"
              />
              <div className="flex items-center gap-2 bg-primary/5 px-3 py-1.5 text-xs text-muted-foreground">
                <svg xmlns="http://www.w3.org/2000/svg" className="size-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <span className="truncate font-medium">{videoFilename}</span>
                {onUploadVideo && (
                  <button
                    type="button"
                    onClick={() => onUploadVideo(block.id)}
                    className="ml-auto shrink-0 text-xs font-semibold text-primary hover:underline"
                  >
                    Sostituisci
                  </button>
                )}
              </div>
            </div>
          ) : onUploadVideo ? (
            /* Segnaposto cliccabile: invita l'utente a caricare direttamente. */
            <button
              type="button"
              onClick={() => onUploadVideo(block.id)}
              className="group/vid flex aspect-video w-full max-w-md cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/30 transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground transition-colors group-hover/vid:bg-primary/10 group-hover/vid:text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </span>
              <span className="text-sm font-medium text-muted-foreground group-hover/vid:text-primary">
                Clicca per caricare un video
              </span>
              <span className="text-xs text-muted-foreground/60">
                MP4 o WebM, max 100 MB
              </span>
            </button>
          ) : (
            <div className="flex aspect-video w-full max-w-md items-center justify-center rounded-lg border border-dashed bg-muted/40 text-sm text-muted-foreground">
              ▶ Segnaposto video
            </div>
          )}
          {(video.alt || video.placeholderPrompt) && (
            <p className="text-xs text-muted-foreground">{video.alt || video.placeholderPrompt}</p>
          )}
          {hasVideo && (
            <TranscriptStatusNote
              status={transcriptStatus}
              error={transcriptError}
              onEdit={onEditTranscript ? () => onEditTranscript(block.id) : undefined}
            />
          )}
        </div>
      );
    }
    default:
      return <p className="text-sm text-muted-foreground">Anteprima non disponibile per questo tipo.</p>;
  }
}
