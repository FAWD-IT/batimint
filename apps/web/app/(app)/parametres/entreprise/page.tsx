import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CompanySettings } from './CompanySettings';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings.company'))('title') };
}

export default function CompanyPage() {
  return <CompanySettings />;
}
