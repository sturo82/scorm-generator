'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FileText, FileUp, Info, Loader2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dropzone } from '@/components/knowledge/dropzone';
import { useToast } from '@/components/ui/toast';
import { SlideAvatarPicker, type AvatarChoice } from '@/components/courses/slide-avatar-picker';
import { getApiClient } from '@/lib/api/client';
import { useImportSlides, useKnowledge, useSlideImportEstimate, useWallet } from '@/lib/api/hooks';
import type { SlideImportView } from '@/lib/api/types';

const fmt = (n: number) => n.toLocaleString('it-IT');

/**
 * Ultimo passo del percorso "da slide": carica il PDF, scegli avatar e voce, vedi il massimo che
 * può costare e avvia. La generazione continua sul server (copioni, revisione se la vuoi, clip con
 * l'avatar, montaggio) e finisce sull'anteprima del corso.
 */
export function NewFromSlides({
  courseId,
  title,
  language,
  initialFile,
  onSwitch,
}: {
  courseId: string;
  title: string;
  language: string;
  /** PDF già scelto nel passo precedente: si carica subito. */
  initialFile?: File;
  /** Torna alla scelta del materiale (per caricare dei video invece del PDF). */
  onSwitch?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const wallet = useWallet();
  const importSlides = useImportSlides(courseId);
  const knowledge = useKnowledge('GLOBAL');
  const [imported, setImported] = React.useState<SlideImportView | null>(null);
  const [choice, setChoice] = React.useState<AvatarChoice | null>(null);
  const [docIds, setDocIds] = React.useState<string[]>([]);
  const [reviewScripts, setReviewScripts] = React.useState(true);
  const [sections, setSections] = React.useState(false);
  const [starting, setStarting] = React.useState(false);

  const readyDocs = React.useMemo(() => (knowledge.data ?? []).filter((d) => d.status === 'READY'), [knowledge.data]);
  const estimate = useSlideImportEstimate(courseId, imported?.importId ?? '', sections, Boolean(imported), {
    engine: choice?.engine,
    avatarType: choice?.avatarType,
  });
  const quote = estimate.data ? (docIds.length > 0 ? estimate.data.withKnowledge : estimate.data.slidesOnly) : null;
  const available = wallet.data?.available ?? wallet.data?.balance;
  const notEnough = Boolean(quote?.priced && estimate.data?.billed && available !== undefined && available < quote.total);

  async function onFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast.show('Carica un file PDF', 'error');
      return;
    }
    try {
      setImported(await importSlides.mutateAsync({ file, language }));
    } catch (err) {
      const msg = err instanceof Error ? err.message.replace(/^API \d+:\s*/, '') : '';
      toast.show(msg || 'Caricamento delle slide non riuscito', 'error');
    }
  }

  const started = React.useRef(false);
  React.useEffect(() => {
    if (initialFile && !started.current) {
      started.current = true;
      void onFiles([initialFile]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  async function start() {
    if (!imported || !choice) return;
    setStarting(true);
    try {
      await getApiClient().startAutopilot(courseId, {
        reviewStructure: false,
        slides: {
          importId: imported.importId,
          avatarId: choice.avatarId,
          avatarType: choice.avatarType,
          engine: choice.engine,
          ...(choice.voiceId ? { voiceId: choice.voiceId } : {}),
          knowledgeDocIds: docIds,
          reviewScripts,
          moduleTitle: title.trim() || undefined,
          sections,
        },
      });
      try {
        // Se apri i copioni per rivederli, il pannello delle slide riparte da questo import.
        window.localStorage.setItem(`slide-video-import:${courseId}`, imported.importId);
      } catch {
        /* storage non disponibile */
      }
      router.push(`/courses/${courseId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message.replace(/^API \d+:\s*/, '') : '';
      toast.show(msg || 'Generazione non avviata', 'error');
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Slide */}
      <section className="space-y-2">
        <p className="text-sm font-medium">1. Le tue slide</p>
        {imported ? (
          <div className="flex items-center gap-3 rounded-lg border border-emerald-300/60 bg-emerald-50 p-3 text-sm text-emerald-900">
            <CheckCircle2 className="size-5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{imported.filename}</p>
              <p className="text-xs">{imported.slides.length} slide pronte</p>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => (onSwitch ? onSwitch() : setImported(null))} disabled={starting}>
              Cambia
            </Button>
          </div>
        ) : (
          <>
            <Dropzone
              onFiles={(f) => void onFiles(f)}
              accept="application/pdf,.pdf"
              disabled={importSlides.isPending}
              title="Trascina qui il PDF delle slide"
              hint="Un solo PDF, una pagina per slide"
            />
            {importSlides.isPending && (
              <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Converto le slide in immagini…
              </p>
            )}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileUp className="size-3.5" aria-hidden /> PDF fino a 50 MB, una pagina per slide.
            </p>
            {onSwitch && !importSlides.isPending && (
              <button type="button" className="text-xs text-muted-foreground underline" onClick={onSwitch}>
                Hai dei video invece del PDF?
              </button>
            )}
          </>
        )}
      </section>

      {imported && (
        <>
          {/* 2. Avatar */}
          <section className="space-y-2">
            <p className="text-sm font-medium">2. Chi le racconta</p>
            <SlideAvatarPicker courseId={courseId} language={language} onChange={setChoice} />
          </section>

          {/* 3. Knowledge (facoltativa) */}
          {readyDocs.length > 0 && (
            <section className="space-y-2">
              <p className="text-sm font-medium">
                3. Arricchisci con la tua knowledge <span className="font-normal text-muted-foreground">(facoltativo)</span>
              </p>
              <div className="flex max-h-40 flex-col gap-1 overflow-auto rounded-lg border p-2">
                {readyDocs.map((d) => (
                  <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent/50">
                    <input
                      type="checkbox"
                      className="size-4 accent-[hsl(var(--primary))]"
                      checked={docIds.includes(d.id)}
                      onChange={(e) => setDocIds((prev) => (e.target.checked ? [...prev, d.id] : prev.filter((x) => x !== d.id)))}
                    />
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">{d.filename}</span>
                  </label>
                ))}
              </div>
            </section>
          )}

          {/* Scelte */}
          <section className="space-y-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
                checked={reviewScripts}
                onChange={(e) => setReviewScripts(e.target.checked)}
              />
              <span>
                Voglio rivedere i copioni prima di generare i video
                <span className="block text-xs text-muted-foreground">
                  La generazione si ferma dopo i copioni e riparte quando confermi: le clip con l&apos;avatar sono la parte che costa di più.
                  Si ferma da sola anche se trova problemi nei copioni.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
                checked={sections}
                onChange={(e) => setSections(e.target.checked)}
              />
              <span>
                Dividi in sezioni, ognuna con il suo quiz
                <span className="block text-xs text-muted-foreground">Utile per presentazioni lunghe; altrimenti è una sola video-lezione.</span>
              </span>
            </label>
          </section>

          {/* Preventivo */}
          <section className="rounded-lg border bg-accent/30 p-3 text-sm">
            {!estimate.data && estimate.isLoading ? (
              <Skeleton className="h-5 w-56" />
            ) : quote && estimate.data?.billed ? (
              quote.priced ? (
                <p>
                  Al massimo <strong>{fmt(quote.total)} crediti</strong> per circa {quote.minutes} min di video: copioni, clip con l&apos;avatar,
                  montaggio, riepilogo e quiz. Paghi solo quanto viene usato davvero.
                </p>
              ) : (
                <p className="text-muted-foreground">Il prezzo di alcune voci non è ancora disponibile.</p>
              )
            ) : (
              <p className="text-muted-foreground">Il costo dipende dalla durata del video generato.</p>
            )}
          </section>

          {notEnough && quote && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900">
              <span>
                Servono fino a <strong>{fmt(quote.total)}</strong> crediti, ne hai <strong>{fmt(available ?? 0)}</strong>: ricarica o accorcia le slide
                prima di generare.
              </span>
              <a href="/wallet" className="font-medium underline">
                Ricarica
              </a>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            Genero tutto sul server: puoi chiudere la pagina. Alla fine trovi il corso nell&apos;anteprima, pronto da rivedere e modificare.
          </div>

          <Button type="button" size="lg" disabled={!choice || starting || notEnough} onClick={() => void start()}>
            {starting ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
            {starting ? 'Avvio…' : choice ? 'Crea e genera il corso' : 'Scegli un avatar'}
          </Button>
        </>
      )}
    </div>
  );
}
