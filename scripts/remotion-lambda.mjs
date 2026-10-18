/*
 * remotion-lambda.mjs — Deploy (idempotente) dell'infrastruttura Remotion
 * Lambda per il rendering "code-to-video" delle pillole:
 *   1) deployFunction  → crea/aggiorna la Lambda di rendering (Chromium incluso);
 *   2) deploySite      → builda la composizione (@scorm/video) e la carica su S3
 *                        (il "serve URL" da cui la Lambda legge il bundle).
 *
 * Da eseguire UNA volta per attivare il rendering su Lambda, e di nuovo quando
 * cambia la composizione (@scorm/video) o si aggiorna Remotion. Stampa i valori
 * da mettere nelle env dell'API:
 *   CARTOON_RENDER_MODE=lambda
 *   CARTOON_LAMBDA_FUNCTION_NAME=<functionName>
 *   CARTOON_LAMBDA_SERVE_URL=<serveUrl>
 *   CARTOON_LAMBDA_REGION=<region>
 *
 * Prerequisiti: credenziali AWS nell'ambiente (AWS_ACCESS_KEY_ID/SECRET o ruolo),
 * e il bucket Remotion (creato automaticamente da deploySite se assente).
 *
 * Variabili d'ambiente:
 *   CARTOON_LAMBDA_REGION   region AWS (default: eu-west-1)
 *   REMOTION_MEMORY_MB      memoria Lambda (default: 2048)
 *   REMOTION_DISK_MB        disco Lambda (default: 2048)
 *   REMOTION_TIMEOUT_SEC    timeout Lambda in secondi (default: 240)
 *   REMOTION_SITE_NAME      nome logico del site (default: scorm-pillole)
 *
 * Uso:
 *   CARTOON_LAMBDA_REGION=eu-west-1 node scripts/remotion-lambda.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  deployFunction,
  deploySite,
  getOrCreateBucket,
} from '@remotion/lambda';

const region = process.env.CARTOON_LAMBDA_REGION || 'eu-west-1';
const memorySizeInMb = Number(process.env.REMOTION_MEMORY_MB || '2048');
const diskSizeInMb = Number(process.env.REMOTION_DISK_MB || '2048');
const timeoutInSeconds = Number(process.env.REMOTION_TIMEOUT_SEC || '240');
const siteName = process.env.REMOTION_SITE_NAME || 'scorm-pillole';

// Entry Remotion del package @scorm/video (compilato in dist).
const here = dirname(fileURLToPath(import.meta.url));
const entryPoint = resolve(here, '../packages/video/dist/remotion-entry.js');

async function main() {
  console.log(`[remotion-lambda] region=${region} entry=${entryPoint}`);

  console.log('[remotion-lambda] deployFunction…');
  const { functionName, alreadyExisted } = await deployFunction({
    region,
    timeoutInSeconds,
    memorySizeInMb,
    diskSizeInMb,
    createCloudWatchLogGroup: true,
  });
  console.log(`[remotion-lambda] functionName=${functionName} (${alreadyExisted ? 'riusata' : 'creata'})`);

  console.log('[remotion-lambda] getOrCreateBucket…');
  const { bucketName } = await getOrCreateBucket({ region });
  console.log(`[remotion-lambda] bucket=${bucketName}`);

  console.log('[remotion-lambda] deploySite (bundle @scorm/video)…');
  const { serveUrl } = await deploySite({
    region,
    bucketName,
    entryPoint,
    siteName,
    options: {
      onBundleProgress: (p) => process.stdout.write(`\r  bundle ${p}%   `),
    },
  });
  console.log(`\n[remotion-lambda] serveUrl=${serveUrl}`);

  console.log('\n=== Imposta queste env sull\'API per attivare il rendering su Lambda ===');
  console.log('CARTOON_RENDER_MODE=lambda');
  console.log(`CARTOON_LAMBDA_FUNCTION_NAME=${functionName}`);
  console.log(`CARTOON_LAMBDA_SERVE_URL=${serveUrl}`);
  console.log(`CARTOON_LAMBDA_REGION=${region}`);
  console.log('(e PROVIDER_CARTOON_VIDEO=remotion)');
}

main().catch((err) => {
  console.error('[remotion-lambda] ERRORE:', err);
  process.exit(1);
});
