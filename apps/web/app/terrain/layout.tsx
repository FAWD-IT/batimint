import type { Metadata, Viewport } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { FieldProvider } from '@/components/field/FieldProvider';
import { TerrainShell } from '@/components/field/TerrainShell';
import { RealtimeProvider } from '@/lib/realtime';
import { getMe } from '@/lib/server-api';
import { SessionProvider } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('field.manifest');
  return {
    title: t('shortName'),
    manifest: '/terrain/manifest.webmanifest',
    appleWebApp: { capable: true, title: t('shortName'), statusBarStyle: 'default' },
    icons: { apple: '/terrain/icon-192.png' },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#F4F3EF',
};

/** Vue terrain (03 §7) : mobile, gros boutons, tutoiement, fonctionne hors ligne. */
export default async function TerrainLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/connexion?next=%2Fterrain');
  return (
    <SessionProvider me={me}>
      <RealtimeProvider>
        <FieldProvider>
          <TerrainShell>{children}</TerrainShell>
        </FieldProvider>
      </RealtimeProvider>
    </SessionProvider>
  );
}
