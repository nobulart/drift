/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  allowedDevOrigins: ['mac-studio.local'],
  images: {
    unoptimized: true
  }
}

module.exports = nextConfig
