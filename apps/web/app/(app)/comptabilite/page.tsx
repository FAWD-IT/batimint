import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AccountingView } from '@/components/accounting/AccountingView';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('accounting'))('title') };
}

export default function Page() {
  return <AccountingView />;
}
