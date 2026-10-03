import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { QuoteEditor } from './QuoteEditor';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('quotes'))('title') };
}

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuoteEditor id={id} />;
}
