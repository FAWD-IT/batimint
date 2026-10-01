import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { TodayView } from './TodayView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('today') };
}

export default function TodayPage() {
  return <TodayView />;
}
