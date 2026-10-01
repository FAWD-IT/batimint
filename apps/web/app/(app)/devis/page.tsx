import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { QuotesView } from './QuotesView';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('quotes'))('title') };
}

export default function QuotesPage() {
  return <QuotesView />;
}
