import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  renderMediaOnLambda,
  getRenderProgress,
  downloadMedia,
  type AwsRegion,
} from '@remotion/lambda';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { computeAllSceneBounds, type VideoSpec, type WordMark } from '@scorm/contracts';
import { COMPOSITION_ID } from './Root.js';
import type { RenderPillolaInput, RenderPillolaResult } from './render.js';

/**
 * Flag: le env REMOTION_AWS_* in uso sono state popolate DA NOI dal ruolo IAM
 * (credenziali temporanee STS) e non fornite dall'esterno. Serve a distinguere
 * le chiavi STATICHE di sviluppo (da lasciare intatte) dalle temporanee (da
 * rinfrescare a ogni render, perché scadono).
 */
let remotionCredsManagedByUs = false;

/**
 * Remotion Lambda NON usa la default credential chain dell'AWS SDK: cerca le env
 * REMOTION_AWS_ACCESS_KEY_ID/SECRET(/SESSION_TOKEN). In produzione l'API gira con
 * un RUOLO IAM (App Runner instance role), senza chiavi statiche: le credenziali
 * sono TEMPORANEE (STS) e scadono (~1h). Per questo le RI-RISOLVIAMO dal provider
 * a OGNI render e sovrascriviamo le env: `defaultProvider()` fa caching interno e
 * le rinnova quando stanno per scadere, evitando l'errore "token expired" sui
 * render successivi al primo.
 *
 * Caso sviluppo: se all'avvio esistono già env REMOTION_AWS_* fornite
 * dall'ESTERNO (chiavi statiche IAM), le lasciamo intatte e non le tocchiamo.
 * Best-effort: se la risoluzione fallisce, si lascia ciò che c'è.
 */
async function ensureRemotionCredentials(): Promise<void> {
  // Chiavi statiche fornite dall'esterno (non da noi): rispettale e non toccarle.
  const hasEnv =
    !!process.env['REMOTION_AWS_ACCESS_KEY_ID'] && !!process.env['REMOTION_AWS_SECRET_ACCESS_KEY'];
  if (hasEnv && !remotionCredsManagedByUs) return;

  try {
    // defaultProvider() memorizza e rinnova le credenziali temporanee vicino alla
    // scadenza: chiamarlo a ogni render garantisce un token valido.
    const creds = await defaultProvider()();
    process.env['REMOTION_AWS_ACCESS_KEY_ID'] = creds.accessKeyId;
    process.env['REMOTION_AWS_SECRET_ACCESS_KEY'] = creds.secretAccessKey;
    if (creds.sessionToken) {
      process.env['REMOTION_AWS_SESSION_TOKEN'] = creds.sessionToken;
    } else {
      // Credenziali senza session token (statiche assunte dal ruolo?): niente stale.
      delete process.env['REMOTION_AWS_SESSION_TOKEN'];
    }
    remotionCredsManagedByUs = true;
  } catch {
    // best-effort: in locale potrebbero esserci già le env statiche.
  }
}

/**
 * Opzioni per il rendering su AWS Lambda (@remotion/lambda). La function e il
 * "site" (bundle della composizione) sono deployati a parte (vedi script di
 * deploy); qui li referenziamo per nome/URL.
 */
export interface LambdaRenderOptions {
  region: string;
  /** Nome della Lambda Remotion deployata (deployFunction → getFunctions). */
  functionName: string;
  /** Serve URL del site Remotion deployato (deploySite). */
  serveUrl: string;
  /** Intervallo di polling del progresso (ms). */
  pollIntervalMs?: number;
  /** Timeout complessivo (ms). */
  timeoutMs?: number;
}

/**
 * RenderFn su Lambda: il voiceover (audio) viene passato come data URL negli
 * inputProps (clip brevi: qualche centinaio di KB), così la Lambda non deve
 * accedere a storage esterni. `renderMediaOnLambda` distribuisce il render su
 * più invocazioni; `getRenderProgress` traccia fino al completamento; poi si
 * scarica l'MP4 e si consegnano i byte, come per l'in-process.
 */
export async function renderPillolaOnLambda(
  input: RenderPillolaInput,
  opts: LambdaRenderOptions,
): Promise<RenderPillolaResult> {
  await ensureRemotionCredentials();
  const audioSrc = toDataUrl(input.audio, input.audioContentType);
  const inputProps: { spec: VideoSpec; audioSrc: string; words: WordMark[] } = {
    spec: input.spec,
    audioSrc,
    words: input.words,
  };
  const region = opts.region as AwsRegion;

  const { renderId, bucketName } = await renderMediaOnLambda({
    region,
    functionName: opts.functionName,
    serveUrl: opts.serveUrl,
    composition: COMPOSITION_ID,
    inputProps,
    codec: 'h264',
  });

  const pollInterval = opts.pollIntervalMs ?? 2000;
  const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
  for (;;) {
    if (Date.now() > deadline) throw new Error('Render Lambda: timeout');
    const progress = await getRenderProgress({ renderId, bucketName, functionName: opts.functionName, region });
    if (progress.fatalErrorEncountered) {
      const msg = progress.errors?.[0]?.message ?? 'errore sconosciuto';
      throw new Error(`Render Lambda fallito: ${msg}`);
    }
    if (progress.done) break;
    await sleep(pollInterval);
  }

  // Scarica l'MP4 prodotto su un file temporaneo e leggine i byte.
  const dir = await mkdtemp(join(tmpdir(), 'pillola-lambda-'));
  const outPath = join(dir, 'out.mp4');
  try {
    await downloadMedia({ region, bucketName, renderId, outPath });
    const bytes = await readFile(outPath);
    return { bytes: new Uint8Array(bytes), durationSec: durationFromSpec(input.spec, input.words) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Durata del video calcolata dallo spec + word-timings (stessa logica del
 * renderer): robusta e type-safe, senza dipendere dai campi interni del
 * progress di Lambda.
 */
function durationFromSpec(spec: VideoSpec, words: WordMark[]): number {
  const fps = spec.canvas.fps;
  const bounds = computeAllSceneBounds(spec.scenes, words, fps);
  const end = bounds.length ? bounds[bounds.length - 1]!.endFrame : fps;
  return Math.max(1, end) / fps;
}

function toDataUrl(bytes: Uint8Array, contentType: string): string {
  const b64 = Buffer.from(bytes).toString('base64');
  return `data:${contentType};base64,${b64}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
