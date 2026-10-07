/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpila i package workspace condivisi (contracts) usati nel client.
  transpilePackages: ['@scorm/contracts'],
  eslint: {
    // Il lint gira come step separato; non blocca il build.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
