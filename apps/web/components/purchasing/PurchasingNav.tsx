'use client';

import { cn } from '@batimint/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCan } from '@/lib/session';

/** Sous-navigation du module Achats : factures, bons de commande, fournisseurs. */
export function PurchasingNav({ inboxCount }: { inboxCount?: number }) {
  const t = useTranslations('purchasing.nav');
  const pathname = usePathname();
  const can = useCan();
  const items = [
    ...(can('supplier_invoices.read')
      ? [{ href: '/achats/factures', label: t('invoices'), count: inboxCount }]
      : []),
    { href: '/achats/commandes', label: t('orders') },
    { href: '/achats/fournisseurs', label: t('suppliers') },
  ];
  return (
    <nav aria-label={t('label')} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {items.map((item) => {
          const current = pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  '-mb-px flex h-11 items-center gap-1.5 border-b-2 px-3 text-[14px] transition-colors duration-[120ms]',
                  'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
                  current
                    ? 'border-ink font-semibold text-ink'
                    : 'border-transparent text-muted hover:text-ink',
                )}
              >
                {item.label}
                {item.count ? (
                  <span className="rounded-full bg-accent px-1.5 text-[12px] font-semibold text-ink-inverse tabular-nums">
                    {item.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
