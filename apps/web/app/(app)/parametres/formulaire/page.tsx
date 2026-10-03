import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WebFormSettings } from './WebFormSettings';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('webform'))('title') };
}

export default function WebFormPage() {
  return <WebFormSettings />;
}
