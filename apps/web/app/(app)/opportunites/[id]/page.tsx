import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OpportunityDetail } from './OpportunityDetail';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('pipeline'))('title') };
}

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OpportunityDetail id={id} />;
}
