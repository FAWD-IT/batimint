import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { EquipmentView } from '@/components/equipment/EquipmentViews';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('equipment'))('detailTitle') };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EquipmentView id={id} />;
}
