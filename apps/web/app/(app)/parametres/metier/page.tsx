import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BusinessSettings } from './BusinessSettings';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings.business'))('title') };
}

export default function BusinessPage() {
  return <BusinessSettings />;
}
