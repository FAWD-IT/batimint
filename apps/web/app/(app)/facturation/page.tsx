import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BillingView } from '@/components/billing/BillingView';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('billing'))('title') };
}

export default function Page() {
  return <BillingView />;
}
