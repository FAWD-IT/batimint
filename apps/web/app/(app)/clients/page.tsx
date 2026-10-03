import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CustomersView } from './CustomersView';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('customers'))('title') };
}

export default function CustomersPage() {
  return <CustomersView />;
}
