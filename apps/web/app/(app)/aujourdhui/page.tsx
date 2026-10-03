import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getMe } from '@/lib/server-api';
import { TodayView } from './TodayView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('today') };
}

export default async function TodayPage() {
  // L'Ouvrier travaille dans la vue terrain (03 §7) : c'est sa page d'accueil.
  const me = await getMe();
  if (me?.role === 'worker') redirect('/terrain');
  return <TodayView />;
}
