import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SettingsIndex } from './SettingsIndex';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('title') };
}

export default function SettingsPage() {
  return <SettingsIndex />;
}
