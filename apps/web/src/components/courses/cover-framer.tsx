'use client';

import * as React from 'react';

/**
 * Rapporto d'aspetto del banner di copertina del corso (larghezza:altezza).
 * UNICA fonte di verità condivisa tra:
 *  - questo strumento di inquadratura (CoverFramer),
 *  - l'hero in anteprima (CoursePreview),
 *  - l'hero del pacchetto SCORM (page-template .course-hero/.overview-hero).
 * Deve restare allineato al CSS dell'export, così "ciò che vedi qui" = "ciò che
 * si vedrà nel corso".
 */
export const COVER_ASPECT = 16 / 6;

/**
 * Strumento visuale per scegliere il punto focale VERTICALE della copertina.
 * Mostra l'immagine INTERA (object-contain) e sovrappone una "finestra" chiara
 * che rappresenta esattamente la porzione che comparirà nel banner del corso
 * (ritaglio al rapporto COVER_ASPECT); il resto è oscurato. Trascinando lo
 * slider (o la finestra) la banda si sposta in verticale: l'autore vede subito
 * cosa resta dentro e cosa viene tagliato.
 *
 * value / onChange: posizione focale 0..100 (0 = alto dell'immagine, 100 = basso),
 * stessa semantica di `object-position: 50% value%`.
 */
export function CoverFramer({
  src,
  value,
  onChange,
  onCommit,
}: {
  src: string;
  value: number;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  const frameRef = React.useRef<HTMLDivElement>(null);
  // Dimensioni naturali dell'immagine: servono per sapere se (e quanto) viene
  // ritagliata in verticale rispetto al rapporto del banner.
  const [nat, setNat] = React.useState<{ w: number; h: number } | null>(null);
  const dragging = React.useRef(false);

  // Altezza della finestra visibile, come frazione (0..1) dell'immagine INTERA
  // mostrata in object-contain. Se l'immagine è più "quadrata/alta" del banner,
  // la finestra è una banda (<1) che scorre; se è più larga del banner, l'intera
  // altezza è visibile (finestra = 1, nessun ritaglio verticale → slider inerte).
  const windowFrac = React.useMemo(() => {
    if (!nat || nat.w === 0 || nat.h === 0) return 1;
    const imgAspect = nat.w / nat.h;
    // porzione verticale mostrata dal banner = imgAspect / bannerAspect, in [0,1].
    return Math.min(1, imgAspect / COVER_ASPECT);
  }, [nat]);

  const noCrop = windowFrac >= 0.999;
  // Posizione (top, in frazione) della finestra data la posizione focale 0..100.
  const topFrac = ((value / 100) * (1 - windowFrac));

  function posFromClientY(clientY: number): number {
    const el = frameRef.current;
    if (!el) return value;
    const rect = el.getBoundingClientRect();
    // Lo stage object-contain riempie la larghezza (il banner è più largo che
    // alto): l'immagine occupa tutta l'altezza del frame. Mappiamo il cursore al
    // centro della finestra, poi convertiamo in 0..100.
    const rel = (clientY - rect.top) / rect.height; // 0..1 nel frame
    const center = Math.max(windowFrac / 2, Math.min(1 - windowFrac / 2, rel));
    const top = center - windowFrac / 2;
    const denom = 1 - windowFrac || 1;
    return Math.round(Math.max(0, Math.min(100, (top / denom) * 100)));
  }

  return (
    <div className="space-y-2">
      <div
        ref={frameRef}
        className="relative w-full select-none overflow-hidden rounded-lg bg-neutral-900"
        style={{ aspectRatio: String(COVER_ASPECT) }}
        onPointerDown={(e) => {
          if (noCrop) return;
          dragging.current = true;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          onChange(posFromClientY(e.clientY));
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          onChange(posFromClientY(e.clientY));
        }}
        onPointerUp={(e) => {
          if (!dragging.current) return;
          dragging.current = false;
          const v = posFromClientY(e.clientY);
          onChange(v);
          onCommit(v);
        }}
      >
        {/* Immagine intera (contenuta), così si vede TUTTA la copertina. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- URL firmato dinamico */}
        <img
          src={src}
          alt=""
          className="pointer-events-none absolute inset-0 size-full object-contain"
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) setNat({ w: img.naturalWidth, h: img.naturalHeight });
          }}
        />
        {/* Oscuramento delle fasce TAGLIATE (sopra e sotto la finestra). */}
        {!noCrop && (
          <>
            <div
              className="pointer-events-none absolute inset-x-0 top-0 bg-black/60"
              style={{ height: `${topFrac * 100}%` }}
            />
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/60"
              style={{ height: `${(1 - topFrac - windowFrac) * 100}%` }}
            />
            {/* Bordo della finestra visibile. */}
            <div
              className="pointer-events-none absolute inset-x-0 border-y-2 border-white/90"
              style={{ top: `${topFrac * 100}%`, height: `${windowFrac * 100}%` }}
            >
              <span className="absolute left-1/2 top-1 -translate-x-1/2 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-800">
                Visibile nel corso
              </span>
            </div>
          </>
        )}
      </div>

      {noCrop ? (
        <p className="text-xs text-muted-foreground">
          L’immagine rientra interamente nel banner: nessun ritaglio verticale da regolare.
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <label htmlFor="cover-pos" className="shrink-0 text-xs font-medium text-muted-foreground">
            Inquadratura verticale
          </label>
          <input
            id="cover-pos"
            type="range"
            min={0}
            max={100}
            step={1}
            value={value}
            aria-label="Posizione verticale della copertina"
            className="h-2 flex-1 cursor-pointer accent-primary"
            onChange={(e) => onChange(Number(e.target.value))}
            onPointerUp={() => onCommit(value)}
            onKeyUp={() => onCommit(value)}
          />
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{value}%</span>
        </div>
      )}
    </div>
  );
}
