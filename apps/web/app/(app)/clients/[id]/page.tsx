import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CustomerDetail } from './CustomerDetail';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('customers'))('title') };
}

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerDetail id={id} />;
}
