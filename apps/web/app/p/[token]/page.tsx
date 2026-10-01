import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PortalQuote } from './PortalQuote';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('portal'))('pageTitle'), robots: { index: false, follow: false } };
}

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PortalQuote token={token} />;
}
