import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The accounts e2e build runs alongside the main one in its own folder.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: ['three'],
};

export default nextConfig;
