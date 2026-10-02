import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { InvoicesView } from '@/components/purchasing/InvoicesView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('purchasing.nav');
  return { title: t('invoices') };
}

export default function Page() {
  return <InvoicesView />;
}
