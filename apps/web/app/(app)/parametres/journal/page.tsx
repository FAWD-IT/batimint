import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuditLog } from './AuditLog';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings.audit'))('title') };
}

export default function Page() {
  return <AuditLog />;
}
