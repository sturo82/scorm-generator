import { readFileSync } from 'node:fs';
import { runtimeAssetPath, type RuntimeAssetFile } from './index.js';

/**
 * Carica un asset del runtime (JS vanilla con guard CommonJS) in un contesto
 * isolato e ne restituisce i module.exports. Usato solo nei test: evita il
 * conflitto ESM/CJS dato che il package è "type": "module", eseguendo lo script
 * in una sandbox con un oggetto `module` fornito.
 */
export function loadRuntimeAsset(file: RuntimeAssetFile): Record<string, unknown> {
  const code = readFileSync(runtimeAssetPath(file), 'utf8');
  const moduleObj = { exports: {} as Record<string, unknown> };
  // Lo script usa `typeof window !== 'undefined' ? window : this`; passandogli
  // `this = globalThis` e un `module`, popola module.exports tramite la guard.
  const fn = new Function('module', 'exports', 'window', code);
  fn.call(globalThis, moduleObj, moduleObj.exports, undefined);
  return moduleObj.exports;
}
