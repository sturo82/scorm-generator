import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { VideoSpec, WordMark } from '@scorm/contracts';
import { COMPOSITION_ID } from './Root.js';

export interface RenderPillolaInput {
  spec: VideoSpec;
  audio: Uint8Array;
  audioContentType: string;
  words: WordMark[];
}

export interface RenderPillolaResult {
  bytes: Uint8Array;
  durationSec: number;
}

/**
 * Rende un VideoSpec in un MP4 (h264) via Remotion headless (Chromium) + FFmpeg.
 * Scrive l'audio e l'output su file temporanei, poi legge i byte dell'MP4 e
 * pulisce. Il bundle della composizione è calcolato una volta e riusato.
 *
 * NB: dipende da Chromium nell'ambiente (vedi @remotion/renderer). Pesante:
 * va eseguito fuori dal thread principale (worker/coda) in produzione.
 */
export async function renderPillola(input: RenderPillolaInput): Promise<RenderPillolaResult> {
  const serveUrl = await getBundle();
  const dir = await mkdtemp(join(tmpdir(), 'pillola-'));
  const ext = input.audioContentType.includes('wav') ? 'wav' : 'mp3';
  const audioPath = join(dir, `voiceover.${ext}`);
  const outPath = join(dir, 'out.mp4');
  try {
    await writeFile(audioPath, Buffer.from(input.audio));
    const inputProps = {
      spec: input.spec,
      audioSrc: `file://${audioPath}`,
      words: input.words,
    };
    const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps });
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: outPath,
      inputProps,
    });
    const bytes = await readFile(outPath);
    const durationSec = composition.durationInFrames / composition.fps;
    return { bytes: new Uint8Array(bytes), durationSec };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Bundle della composizione Remotion, calcolato una sola volta (cache modulo). */
let bundlePromise: Promise<string> | null = null;
function getBundle(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: new URL('./remotion-entry.js', import.meta.url).pathname,
    });
  }
  return bundlePromise;
}
