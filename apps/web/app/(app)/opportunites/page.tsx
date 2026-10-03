import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OpportunitiesView } from './OpportunitiesView';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('pipeline'))('title') };
}

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ vue?: string }>;
}) {
  const { vue } = await searchParams;
  return <OpportunitiesView initialTab={vue === 'demandes' ? 'leads' : 'pipeline'} />;
}
