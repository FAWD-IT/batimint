import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OrdersView } from '@/components/purchasing/OrdersView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('purchasing.nav');
  return { title: t('orders') };
}

export default function Page() {
  return <OrdersView />;
}
