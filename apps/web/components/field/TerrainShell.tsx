'use client';

import { cn } from '@batimint/ui';
import { Clock3, House, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

/** Coquille mobile de la vue terrain : contenu plein écran et barre d'onglets en bas (pouce). */
export function TerrainShell({ children }: { children: ReactNode }) {
  const t = useTranslations('field.nav');
  const tc = useTranslations('common');
  const pathname = usePathname();
  const items = [
    {
      href: '/terrain',
      label: t('today'),
      icon: House,
      active: pathname === '/terrain' || pathname === '/terrain/rapport',
    },
    {
      href: '/terrain/heures',
      label: t('hours'),
      icon: Clock3,
      active: pathname.startsWith('/terrain/heures'),
    },
    {
      href: '/terrain/profil',
      label: t('profile'),
      icon: UserRound,
      active: pathname.startsWith('/terrain/profil'),
    },
  ];
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <a
        href="#terrain-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-[10px] focus:bg-surface focus:px-3 focus:py-2"
      >
        {tc('skipToContent')}
      </a>
      <main
        id="terrain-main"
        className="mx-auto flex w-full max-w-[520px] flex-1 flex-col gap-4 px-5 pt-[max(28px,env(safe-area-inset-top))] pb-28"
      >
        {children}
      </main>
      <nav
        aria-label={t('label')}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[max(16px,env(safe-area-inset-bottom))]"
      >
        <ul className="mx-auto grid max-w-[520px] grid-cols-3 px-2 pt-2">
          {items.map((it) => (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={it.active ? 'page' : undefined}
                className={cn(
                  'flex min-h-12 flex-col items-center justify-center gap-1 rounded-[12px] text-[12px]',
                  'focus-visible:outline-2 focus-visible:outline-accent',
                  it.active ? 'font-semibold text-ink' : 'text-muted',
                )}
              >
                <it.icon aria-hidden className="size-[22px]" strokeWidth={2} />
                {it.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
