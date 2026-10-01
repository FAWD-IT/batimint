import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self)' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: root,
  transpilePackages: ['@batimint/ui', '@batimint/contracts', '@batimint/domain'],
  poweredByHeader: false,
  // Le flux SSE transite par le proxy /api/v1 : pas de compression qui bufferiserait.
  compress: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default createNextIntlPlugin('./i18n/request.ts')(nextConfig);
