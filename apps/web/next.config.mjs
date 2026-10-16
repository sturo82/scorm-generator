import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/**
 * Config Next. In PRODUZIONE (build) usa l'export statico: Next produce
 * HTML/JS/CSS puri in `out/`, serviti da S3 + CloudFront (nessun server Node;
 * app client-side, dati via API a runtime). Le route dinamiche (es. /courses/[id])
 * usano una shell segnaposto + fallback CDN.
 *
 * In SVILUPPO (`next dev`) l'export statico è DISATTIVATO: con `output: 'export'`
 * e `dynamicParams=false` il dev server sa servire SOLO gli id generati da
 * generateStaticParams (es. "placeholder") e lancia un 500 su un id reale, perché
 * in dev non esiste il fallback CDN. Disattivandolo, le route dinamiche vengono
 * renderizzate on-demand come un normale dev server. La build di produzione resta
 * identica a prima.
 *
 * @param {string} phase
 * @returns {import('next').NextConfig}
 */
export default function nextConfig(phase) {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    reactStrictMode: true,
    // Export statico solo per la build di produzione (non in `next dev`).
    ...(isDev ? {} : { output: 'export' }),
    // L'ottimizzazione immagini richiede un server: disabilitata nell'export.
    images: { unoptimized: true },
    // In PRODUZIONE: ogni route diventa `path/index.html` (routing pulito su
    // S3/CloudFront). In SVILUPPO lo disattiviamo: con `trailingSlash: true` il
    // dev server di Next 14 non risolve le route DINAMICHE con slash finale
    // (es. /courses/<id>/) e risponde 404. Senza, le route dinamiche funzionano
    // on-demand. La build di produzione resta invariata.
    ...(isDev ? {} : { trailingSlash: true }),
    // Transpila i package workspace condivisi usati nel client (contracts +
    // scorm, quest'ultimo per la ricerca semantica offline).
    transpilePackages: ['@scorm/contracts', '@scorm/scorm'],
    eslint: {
      // Il lint gira come step separato; non blocca il build.
      ignoreDuringBuilds: true,
    },
  };
}
