import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SubcontractorView } from '@/components/subcontracting/SubcontractorView';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('subcontracting'))('detailTitle') };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SubcontractorView id={id} />;
}
