import { getTranslations } from 'next-intl/server';

/** Manifeste de l'app terrain installable (PWA), traduit comme le reste de l'interface. */
export async function GET(): Promise<Response> {
  const t = await getTranslations('field.manifest');
  const manifest = {
    id: '/terrain',
    name: t('name'),
    short_name: t('shortName'),
    description: t('description'),
    lang: 'fr-BE',
    start_url: '/terrain',
    scope: '/terrain',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F4F3EF',
    theme_color: '#F4F3EF',
    icons: [
      { src: '/terrain/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/terrain/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/terrain/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      'content-type': 'application/manifest+json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
