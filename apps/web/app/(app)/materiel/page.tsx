import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { EquipmentListView } from '@/components/equipment/EquipmentViews';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('equipment'))('title') };
}

export default function Page() {
  return <EquipmentListView />;
}
