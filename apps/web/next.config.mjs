/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Export statico: Next produce HTML/JS/CSS puri in `out/`, serviti da
  // S3 + CloudFront. Nessun server Node per il frontend (app interamente
  // client-side, dati via API a runtime).
  output: 'export',
  // L'ottimizzazione immagini richiede un server: disabilitata nell'export.
  images: { unoptimized: true },
  // Ogni route diventa `path/index.html`: routing pulito su S3/CloudFront e
  // fallback coerente per le route dinamiche (shell segnaposto).
  trailingSlash: true,
  // Transpila i package workspace condivisi usati nel client (contracts +
  // scorm, quest'ultimo per la ricerca semantica offline).
  transpilePackages: ['@scorm/contracts', '@scorm/scorm'],
  eslint: {
    // Il lint gira come step separato; non blocca il build.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
