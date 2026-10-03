import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SubcontractorsView } from '@/components/subcontracting/SubcontractorsView';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('subcontracting'))('title') };
}

export default function Page() {
  return <SubcontractorsView />;
}
