import { Card, PageHeader } from '@batimint/ui';
import { ChevronRight, Radio } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('title') };
}

export default async function SettingsPage() {
  const t = await getTranslations('settings');
  const sections = [{ href: '/parametres/diagnostic', icon: Radio, title: t('diagnostic.title'), description: t('diagnostic.description') }];
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title={t('title')} />
      <Card className="p-2 md:p-2">
        <ul>
          {sections.map((s) => (
            <li key={s.href}>
              <Link href={s.href} className="flex items-center gap-4 rounded-[12px] p-3 hover:bg-line-soft focus-visible:outline-2 focus-visible:outline-accent">
                <span className="flex size-10 items-center justify-center rounded-[10px] bg-line-soft">
                  <s.icon aria-hidden className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{s.title}</span>
                  <span className="block text-[13px] text-muted">{s.description}</span>
                </span>
                <ChevronRight aria-hidden className="size-4 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
