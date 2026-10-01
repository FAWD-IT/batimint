'use client';

import { LiveIndicator, Logo } from '@batimint/ui';
import { Menu, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';
import { useRealtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { NotificationsBell } from './NotificationsBell';
import { Sidebar, SidebarContent } from './Sidebar';

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const me = useSession();
  const { connected } = useRealtime();
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <div className="flex min-h-dvh">
      <a href="#contenu" className="skip-link">
        {t('common.skipToContent')}
      </a>
      <Sidebar />
      {menuOpen ? (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={t('nav.main')}
        >
          <button
            type="button"
            aria-label={t('nav.closeMenu')}
            className="absolute inset-0 bg-black/40"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[280px] bg-panel text-white">
            <button
              type="button"
              aria-label={t('nav.closeMenu')}
              onClick={() => setMenuOpen(false)}
              className="absolute top-5 right-3 flex size-11 items-center justify-center rounded-[12px] text-white hover:bg-white/10"
            >
              <X aria-hidden className="size-5" />
            </button>
            <SidebarContent onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-bg/95 px-4 backdrop-blur md:px-8">
          <button
            type="button"
            aria-label={t('nav.openMenu')}
            onClick={() => setMenuOpen(true)}
            className="flex size-11 items-center justify-center rounded-[12px] border border-line bg-surface lg:hidden"
          >
            <Menu aria-hidden className="size-5" />
          </button>
          <span className="lg:hidden">
            <Logo />
          </span>
          {me.impersonating ? (
            <span className="rounded-full bg-warn px-3 py-1 text-[12px] font-semibold text-white">
              {t('nav.impersonating')}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden sm:inline-flex">
              <LiveIndicator
                label={t('common.live')}
                offlineLabel={t('common.reconnecting')}
                connected={connected}
              />
            </span>
            <NotificationsBell />
          </div>
        </header>
        <main id="contenu" tabIndex={-1} className="flex-1 px-4 py-6 outline-none md:px-8 md:py-7">
          {children}
        </main>
      </div>
    </div>
  );
}
