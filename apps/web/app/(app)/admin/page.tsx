import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AdminView } from './AdminView';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('admin'))('title') };
}

export default function AdminPage() {
  return <AdminView />;
}
