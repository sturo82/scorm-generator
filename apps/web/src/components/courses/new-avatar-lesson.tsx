'use client';

import * as React from 'react';
import { FileText, Film, UploadCloud } from 'lucide-react';
import { VIDEO_SCRIPT } from '@scorm/contracts';
import { Dropzone } from '@/components/knowledge/dropzone';
import { useToast } from '@/components/ui/toast';
import { NewFromSlides } from '@/components/courses/new-from-slides';
import { NewFromVideos } from '@/components/courses/new-from-videos';

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const isVideo = (f: File) => /^video\/(mp4|webm|quicktime)$/.test(f.type) || /\.(mp4|webm|mov)$/i.test(f.name);

/**
 * Video-lezione con avatar: un solo riquadro in cui si trascina il materiale che si ha. Un PDF
 * diventa una lezione da slide, uno o più video diventano capitoli raccontati dall'avatar: il
 * tipo si riconosce dal file e la pagina si adatta, senza chiedere prima "da slide o da video".
 */
export function NewAvatarLesson({ courseId, title, language }: { courseId: string; title: string; language: string }) {
  const toast = useToast();
  const [pick, setPick] = React.useState<{ kind: 'slides'; file: File } | { kind: 'videos'; files: File[] } | { kind: 'manual'; as: 'slides' | 'videos' } | null>(null);

  function onFiles(files: File[]) {
    const pdfs = files.filter(isPdf);
    const videos = files.filter(isVideo);
    const other = files.length - pdfs.length - videos.length;
    if (pdfs.length && videos.length) {
      toast.show('Carica un PDF oppure dei video: una video-lezione non può ancora mescolarli', 'error');
      return;
    }
    if (pdfs.length > 1) {
      toast.show('Carica un solo PDF: diventa una video-lezione', 'error');
      return;
    }
    if (other > 0 && !pdfs.length && !videos.length) {
      toast.show('Usa un PDF delle slide oppure video MP4, WebM o MOV', 'error');
      return;
    }
    if (pdfs[0]) setPick({ kind: 'slides', file: pdfs[0] });
    else if (videos.length) setPick({ kind: 'videos', files: videos });
  }

  if (pick?.kind === 'slides' || (pick?.kind === 'manual' && pick.as === 'slides')) {
    return (
      <NewFromSlides
        courseId={courseId}
        title={title}
        language={language}
        initialFile={pick.kind === 'slides' ? pick.file : undefined}
        onSwitch={() => setPick({ kind: 'manual', as: 'videos' })}
      />
    );
  }
  if (pick?.kind === 'videos' || (pick?.kind === 'manual' && pick.as === 'videos')) {
    return (
      <NewFromVideos
        courseId={courseId}
        title={title}
        language={language}
        initialFiles={pick.kind === 'videos' ? pick.files : undefined}
        onSwitch={() => setPick({ kind: 'manual', as: 'slides' })}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Dropzone
        onFiles={onFiles}
        accept="application/pdf,.pdf,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
        title="Trascina qui il PDF delle slide oppure i tuoi video"
        hint="Riconosco il tipo da solo: poi scegli l’avatar che li racconta"
        icon={<UploadCloud className="size-6" />}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex gap-3 rounded-lg border bg-muted/20 p-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
            <FileText className="size-5" />
          </div>
          <div className="text-sm">
            <p className="font-medium">Un PDF di slide</p>
            <p className="text-xs text-muted-foreground">L&apos;avatar racconta ogni slide. Puoi arricchire i copioni con la tua knowledge.</p>
          </div>
        </div>
        <div className="flex gap-3 rounded-lg border bg-muted/20 p-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
            <Film className="size-5" />
          </div>
          <div className="text-sm">
            <p className="font-medium">Uno o più video</p>
            <p className="text-xs text-muted-foreground">
              Ogni video diventa un capitolo, con un copione tarato sulla sua durata. Fino a {VIDEO_SCRIPT.maxVideos} video.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
