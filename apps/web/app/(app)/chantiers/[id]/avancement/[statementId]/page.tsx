import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { StatementEditor } from '@/components/billing/StatementEditor';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('billing.statement'))('pageTitle') };
}

export default async function Page({ params }: { params: Promise<{ id: string; statementId: string }> }) {
  const { id, statementId } = await params;
  return <StatementEditor projectId={id} statementId={statementId} />;
}
