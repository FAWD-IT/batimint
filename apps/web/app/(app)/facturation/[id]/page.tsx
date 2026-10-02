import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { InvoiceDetail } from '@/components/billing/InvoiceDetail';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('billing'))('title') };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoiceDetail id={id} />;
}
