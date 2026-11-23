/**
 * Lettura di un video nel browser: durata, fotogramma di copertina e qualche fotogramma del tratto
 * scelto (per far scrivere all'AI il copione guardando il video). Il server non decodifica video,
 * quindi questo lavoro si fa qui, prima del caricamento.
 */

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'auto';
    v.muted = true;
    v.playsInline = true;
    v.crossOrigin = 'anonymous';
    v.src = url;
    v.onloadedmetadata = () => resolve(v);
    v.onerror = () => reject(new Error('Video non leggibile dal browser: prova a convertirlo in MP4 (H.264)'));
  });
}

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      v.removeEventListener('seeked', done);
      resolve();
    };
    v.addEventListener('seeked', done);
    v.currentTime = Math.min(Math.max(0, t), Math.max(0, v.duration - 0.05));
  });
}

function grab(v: HTMLVideoElement, maxW: number, type: 'image/png' | 'image/jpeg', quality = 0.82): Promise<Blob> {
  const scale = Math.min(1, maxW / (v.videoWidth || maxW));
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round((v.videoWidth || 1280) * scale));
  c.height = Math.max(2, Math.round((v.videoHeight || 720) * scale));
  c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Fotogramma non estraibile'))), type, quality));
}

/**
 * Durata di un file video (s), letta dai metadati. Se si passa `maxSize`, rifiuta i video oltre quella
 * risoluzione (lato lungo × lato corto, vale anche per i video verticali).
 */
export async function videoDuration(file: File, maxSize?: { longSide: number; shortSide: number }): Promise<number> {
  const url = URL.createObjectURL(file);
  try {
    const v = await loadVideo(url);
    if (!Number.isFinite(v.duration) || v.duration <= 0) throw new Error('Durata del video non leggibile');
    if (maxSize && v.videoWidth && v.videoHeight) {
      const long = Math.max(v.videoWidth, v.videoHeight);
      const short = Math.min(v.videoWidth, v.videoHeight);
      if (long > maxSize.longSide || short > maxSize.shortSide) {
        throw new Error(
          `risoluzione ${v.videoWidth}×${v.videoHeight} troppo alta: esportalo in 1080p (${maxSize.longSide}×${maxSize.shortSide}) e ricaricalo`,
        );
      }
    }
    return Math.round(v.duration * 100) / 100;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Copertina (PNG, 1280 px) e 4 fotogrammi (JPEG, 768 px) distribuiti nel tratto [start, end]. */
export async function videoStills(file: File, range?: { start: number; end: number }): Promise<{ poster: Blob; frames: Blob[] }> {
  const url = URL.createObjectURL(file);
  try {
    const v = await loadVideo(url);
    const start = range?.start ?? 0;
    const end = range?.end ?? v.duration;
    const len = Math.max(0.5, end - start);
    await seek(v, start + Math.min(1, len * 0.1));
    const poster = await grab(v, 1280, 'image/png');
    const frames: Blob[] = [];
    for (const f of [0.15, 0.38, 0.62, 0.85]) {
      await seek(v, start + len * f);
      frames.push(await grab(v, 768, 'image/jpeg'));
    }
    return { poster, frames };
  } finally {
    URL.revokeObjectURL(url);
  }
}
