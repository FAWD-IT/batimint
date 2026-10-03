import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ReceivablesView } from '@/components/billing/ReceivablesView';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('billing.nav'))('receivables') };
}

export default function Page() {
  return <ReceivablesView />;
}
