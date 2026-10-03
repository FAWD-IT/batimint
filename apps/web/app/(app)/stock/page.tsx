import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { StockView } from '@/components/stock/StockView';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('stock'))('title') };
}

export default function Page() {
  return <StockView />;
}
