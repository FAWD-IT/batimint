import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PortalEntry } from './PortalEntry';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getTranslations('portalProject'))('pageTitle'),
    robots: { index: false, follow: false },
  };
}

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PortalEntry token={token} />;
}
