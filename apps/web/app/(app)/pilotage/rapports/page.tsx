import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ReportsView } from '@/components/reporting/ReportsView';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('reports'))('title') };
}

export default function Page() {
  return <ReportsView />;
}
