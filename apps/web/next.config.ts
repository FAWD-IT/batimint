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
  transpilePackages: ['@batimint/ui', '@batimint/contracts', '@batimint/domain', 'geist'],
  poweredByHeader: false,
  // L'indicateur de développement recouvre la barre d'onglets du terrain (coin bas gauche).
  devIndicators: false,
  // Le flux SSE transite par le proxy /api/v1 : pas de compression qui bufferiserait.
  compress: false,
  async headers() {
    return [
      { source: '/((?!f/).*)', headers: securityHeaders },
      // Service worker de la vue terrain : servi depuis /terrain/, il contrôle aussi /terrain.
      {
        source: '/terrain/sw.js',
        headers: [
          { key: 'Service-Worker-Allowed', value: '/terrain' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
      // Le formulaire de demande est conçu pour être intégré (iframe) sur le site du client.
      {
        source: '/f/:path*',
        headers: [
          ...securityHeaders.filter((h) => h.key !== 'X-Frame-Options'),
          { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
        ],
      },
    ];
  },
};

export default createNextIntlPlugin('./i18n/request.ts')(nextConfig);
