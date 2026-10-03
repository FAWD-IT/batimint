import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MockCheckout } from './MockCheckout';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getTranslations('mockCheckout'))('pageTitle'),
    robots: { index: false, follow: false },
  };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MockCheckout id={id} />;
}
