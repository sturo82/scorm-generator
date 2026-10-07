import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Percorsi degli asset del runtime SCORM (JS vanilla eseguito nel browser
 * dell'LMS). Il packager li copia nel pacchetto sotto /runtime. Sono file
 * statici self-contained, senza dipendenze né rete (Requisito 9.4).
 */

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(here, 'assets');

/** Nomi dei file del runtime, nell'ordine di inclusione raccomandato. */
export const RUNTIME_ASSET_FILES = [
  'scorm-api.js',
  'scoring.js',
  // Renderer condiviso (bundle IIFE del core @scorm/contracts/render-core):
  // espone window.RenderCore ed è usato da renderers.js. Caricato PRIMA di
  // renderers.js. Generato al build via esbuild (bundle-render-core).
  'render-core.js',
  'renderers.js',
  'player.js',
  'semantic-runtime.js',
  'rag.js',
] as const;

export type RuntimeAssetFile = (typeof RUNTIME_ASSET_FILES)[number];

/** Percorso assoluto sul filesystem di un asset del runtime. */
export function runtimeAssetPath(file: RuntimeAssetFile): string {
  return join(ASSETS_DIR, file);
}

/** Directory che contiene gli asset del runtime. */
export function runtimeAssetsDir(): string {
  return ASSETS_DIR;
}
