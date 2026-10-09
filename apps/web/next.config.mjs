/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Output "standalone": Next produce un server minimale con solo le dipendenze
  // necessarie (node_modules tracciati) → immagine Docker di produzione molto
  // più piccola. Richiesto per il deploy containerizzato su ECS Fargate.
  output: 'standalone',
  // Transpila i package workspace condivisi (contracts) usati nel client.
  transpilePackages: ['@scorm/contracts'],
  eslint: {
    // Il lint gira come step separato; non blocca il build.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
