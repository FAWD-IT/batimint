import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DashboardView } from '@/components/reporting/DashboardView';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('dashboard'))('title') };
}

export default function Page() {
  return <DashboardView />;
}
