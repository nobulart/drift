/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  allowedDevOrigins: ['mac-studio.local'],
  experimental: {
    outputFileTracingExcludes: {
      '/*': [
        './docs/src/outputs/**/*',
        './public/data/.rolling-stats-cache/**/*',
        './public/data/.phase-escape-cache/**/*',
        './public/data/.phase-stability-cache/**/*',
        './public/data/ephemeris_historic.json',
        './public/data/finals.all.json',
      ],
    },
  },
  images: {
    unoptimized: true
  }
}

module.exports = nextConfig
