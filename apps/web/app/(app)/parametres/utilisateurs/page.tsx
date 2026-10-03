import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { UsersSettings } from './UsersSettings';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings.users'))('title') };
}

export default function UsersPage() {
  return <UsersSettings />;
}
