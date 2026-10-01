'use client';

import { cn, Logo } from '@batimint/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCan } from '@/lib/session';
import { NAV_ITEMS } from './nav';
import { UserMenu } from './UserMenu';

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const can = useCan();
  return (
    <div className="flex h-full flex-col gap-6 px-4 py-6">
      <div className="px-2">
        <Logo inverted />
      </div>
      <nav aria-label={t('main')} className="flex flex-col gap-0.5">
        {NAV_ITEMS.filter((i) => !i.permission || can(i.permission)).map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-[38px] items-center gap-2.5 rounded-[10px] px-3 text-[14px] transition-colors duration-[120ms]',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7D93FF]',
                active ? 'bg-white font-semibold text-[#111111]' : 'text-[#CFCFCF] hover:bg-white/10 hover:text-white',
              )}
            >
              <Icon aria-hidden className="size-4" />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto">
        <UserMenu />
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 overflow-y-auto bg-panel text-white lg:block">
      <SidebarContent />
    </aside>
  );
}
