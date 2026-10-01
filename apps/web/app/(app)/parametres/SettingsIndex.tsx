'use client';

import type { Action } from '@batimint/domain';
import { Card, ErrorState, PageHeader } from '@batimint/ui';
import { ChevronRight, type LucideIcon, Radio } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCan } from '@/lib/session';

interface Section {
  href: string;
  icon: LucideIcon;
  titleKey: 'diagnostic.title';
  descriptionKey: 'diagnostic.description';
  permission: Action;
}

const SECTIONS: Section[] = [
  {
    href: '/parametres/diagnostic',
    icon: Radio,
    titleKey: 'diagnostic.title',
    descriptionKey: 'diagnostic.description',
    permission: 'diagnostics.run',
  },
];

export function SettingsIndex() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const can = useCan();
  const sections = SECTIONS.filter((s) => can(s.permission));
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title={t('title')} />
      {sections.length === 0 ? (
        <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />
      ) : (
        <Card className="p-2 md:p-2">
          <ul>
            {sections.map((s) => (
              <li key={s.href}>
                <Link
                  href={s.href}
                  className="flex items-center gap-4 rounded-[12px] p-3 hover:bg-line-soft focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className="flex size-10 items-center justify-center rounded-[10px] bg-line-soft">
                    <s.icon aria-hidden className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold">{t(s.titleKey)}</span>
                    <span className="block text-[13px] text-muted">{t(s.descriptionKey)}</span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
