import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SuppliersView } from '@/components/purchasing/SuppliersView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('purchasing.nav');
  return { title: t('suppliers') };
}

export default function Page() {
  return <SuppliersView />;
}
