import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DiagnosticView } from './DiagnosticView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.diagnostic');
  return { title: t('title') };
}

export default function DiagnosticPage() {
  return <DiagnosticView />;
}
