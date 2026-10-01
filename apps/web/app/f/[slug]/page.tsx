import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiInternalUrl } from '@/lib/server-api';
import { PublicLeadForm } from './PublicLeadForm';

interface FormConfig {
  tenantName: string;
  accent: string;
  logoUrl: string | null;
}

async function loadConfig(slug: string): Promise<FormConfig | null> {
  const res = await fetch(`${apiInternalUrl()}/v1/public/forms/${encodeURIComponent(slug)}`, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API formulaire ${res.status}`);
  return (await res.json()) as FormConfig;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const t = await getTranslations('webform.public');
  const config = await loadConfig(slug).catch(() => null);
  return { title: config ? `${t('title')} — ${config.tenantName}` : t('title'), robots: { index: false } };
}

export default async function PublicFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ embed?: string; preview?: string }>;
}) {
  const [{ slug }, { embed, preview }] = await Promise.all([params, searchParams]);
  const config = await loadConfig(slug);
  if (!config) notFound();
  return (
    <PublicLeadForm
      slug={slug}
      tenantName={config.tenantName}
      accent={config.accent}
      logoUrl={config.logoUrl}
      embedded={embed === '1'}
      preview={preview === '1'}
    />
  );
}
