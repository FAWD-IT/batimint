import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SubscriptionSettings } from './SubscriptionSettings';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings.subscription'))('title') };
}

export default function Page() {
  return <SubscriptionSettings />;
}
