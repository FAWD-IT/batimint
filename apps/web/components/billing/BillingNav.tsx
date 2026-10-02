'use client';

import { cn } from '@batimint/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

/** Sous-navigation de la facturation : factures, encours clients. */
export function BillingNav() {
  const t = useTranslations('billing.nav');
  const pathname = usePathname();
  const items = [
    { href: '/facturation', label: t('invoices'), current: !pathname.startsWith('/facturation/encours') },
    {
      href: '/facturation/encours',
      label: t('receivables'),
      current: pathname.startsWith('/facturation/encours'),
    },
  ];
  return (
    <nav aria-label={t('label')} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.current ? 'page' : undefined}
              className={cn(
                '-mb-px flex h-11 items-center border-b-2 px-3 text-[14px] transition-colors duration-[120ms]',
                'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
                item.current
                  ? 'border-ink font-semibold text-ink'
                  : 'border-transparent text-muted hover:text-ink',
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
