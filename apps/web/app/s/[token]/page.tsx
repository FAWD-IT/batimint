import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SubcontractorPortal } from '@/components/portal/SubcontractorPortal';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getTranslations('portalSubcontractor'))('pageTitle'),
    robots: { index: false, follow: false },
  };
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SubcontractorPortal token={token} />;
}
