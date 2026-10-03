'use client';

import type { Action } from '@batimint/domain';
import { Card, ErrorState, PageHeader } from '@batimint/ui';
import {
  Building2,
  Globe,
  ChevronRight,
  CreditCard,
  History,
  type LucideIcon,
  Plug,
  Radio,
  SlidersHorizontal,
  UserRound,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCan } from '@/lib/session';

interface Section {
  href: string;
  icon: LucideIcon;
  key:
    | 'company'
    | 'business'
    | 'users'
    | 'integrations'
    | 'webform'
    | 'subscription'
    | 'audit'
    | 'diagnostic'
    | 'account';
  permission?: Action;
}

const SECTIONS: Section[] = [
  { href: '/parametres/entreprise', icon: Building2, key: 'company', permission: 'company.update' },
  { href: '/parametres/metier', icon: SlidersHorizontal, key: 'business', permission: 'settings.update' },
  { href: '/parametres/utilisateurs', icon: Users, key: 'users', permission: 'members.read' },
  { href: '/parametres/integrations', icon: Plug, key: 'integrations', permission: 'integrations.manage' },
  { href: '/parametres/formulaire', icon: Globe, key: 'webform', permission: 'company.read' },
  {
    href: '/parametres/abonnement',
    icon: CreditCard,
    key: 'subscription',
    permission: 'subscription.manage',
  },
  { href: '/parametres/journal', icon: History, key: 'audit', permission: 'audit.read' },
  { href: '/parametres/diagnostic', icon: Radio, key: 'diagnostic', permission: 'diagnostics.run' },
  { href: '/compte', icon: UserRound, key: 'account' },
];

export function SettingsIndex() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const can = useCan();
  const ta = useTranslations('account');
  const sections = SECTIONS.filter((s) => !s.permission || can(s.permission));
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
                    <span className="block text-[15px] font-semibold">
                      {s.key === 'account'
                        ? ta('title')
                        : s.key === 'diagnostic'
                          ? t('diagnostic.title')
                          : t(`sections.${s.key}.title`)}
                    </span>
                    <span className="block text-[13px] text-muted">
                      {s.key === 'account'
                        ? ta('profile')
                        : s.key === 'diagnostic'
                          ? t('diagnostic.description')
                          : t(`sections.${s.key}.description`)}
                    </span>
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
