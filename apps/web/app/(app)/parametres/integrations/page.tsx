import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { IntegrationsSettings } from './IntegrationsSettings';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings.integrations'))('title') };
}

export default function Page() {
  return <IntegrationsSettings />;
}
