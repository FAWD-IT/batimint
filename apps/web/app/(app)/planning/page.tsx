import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PlanningView } from '@/components/planning/PlanningView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('planning');
  return { title: t('title') };
}

export default function PlanningPage() {
  return <PlanningView />;
}
