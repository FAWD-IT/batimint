'use client';

import type { ProjectSummaryDto } from '@batimint/contracts';
import { percentInt } from '@batimint/domain';
import { cn, Logo } from '@batimint/ui';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCommandPalette } from '@/components/command/CommandPalette';
import { useApi } from '@/lib/hooks';
import { useCan, useSession } from '@/lib/session';
import { NAV_ITEMS } from './nav';
import { UserMenu } from './UserMenu';

const HEALTH_DOT = { ok: 'bg-good', warn: 'bg-warn', crit: 'bg-crit' } as const;
const SIDEBAR_PROJECTS = 6;

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('nav');
  const tp = useTranslations('projects');
  const pathname = usePathname();
  const can = useCan();
  const me = useSession();
  const palette = useCommandPalette();
  const projects = useApi<{ items: ProjectSummaryDto[] }>(
    ['projects', 'sidebar'],
    can('projects.read') ? `/projects?view=active&limit=${SIDEBAR_PROJECTS}` : null,
  );
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <div className="flex h-full flex-col gap-5 px-4 py-6">
      <div className="px-2">
        <Logo inverted />
      </div>
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          palette.open();
        }}
        aria-label={t('searchLabel')}
        aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
        className="flex h-10 items-center gap-2 rounded-[10px] border border-white/15 bg-white/5 px-3 text-left text-[13px] text-[#B8B8B8] hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7D93FF]"
      >
        <Search aria-hidden className="size-4" />
        <span className="flex-1 truncate">{t('search')}</span>
        <kbd className="rounded-[6px] border border-white/20 px-1.5 text-[11px] font-semibold">
          {mac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>
      <nav aria-label={t('main')} className="flex flex-col gap-0.5">
        {NAV_ITEMS.filter(
          (i) => (!i.permission || can(i.permission)) && (!i.platformAdmin || me.user.isPlatformAdmin),
        ).map((item) => {
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
                active
                  ? 'bg-white font-semibold text-[#111111]'
                  : 'text-[#CFCFCF] hover:bg-white/10 hover:text-white',
              )}
            >
              <Icon aria-hidden className="size-4" />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>
      {can('projects.read') && projects.data ? (
        <section aria-labelledby="sidebar-active-projects" className="flex flex-col gap-1">
          <h2
            id="sidebar-active-projects"
            className="px-3 pb-1 text-[11px] font-semibold tracking-[0.08em] text-[#8F8F8F] uppercase"
          >
            {t('activeProjects')}
          </h2>
          {projects.data.items.length === 0 ? (
            <p className="px-3 text-[13px] text-[#8F8F8F]">{t('noActiveProjects')}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {projects.data.items.map((p) => {
                const href = `/chantiers/${p.id}`;
                const active = pathname === href || pathname.startsWith(`${href}/`);
                const pct = percentInt(p.progress);
                return (
                  <li key={p.id}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      aria-label={`${p.shortLabel}, ${pct} %, ${tp(`health.${p.health}`)}`}
                      className={cn(
                        'flex min-h-9 items-center gap-2.5 rounded-[10px] px-3 py-1.5 text-[13px] transition-colors duration-[120ms]',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7D93FF]',
                        active
                          ? 'bg-white/15 text-white'
                          : 'text-[#CFCFCF] hover:bg-white/10 hover:text-white',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn('size-2 shrink-0 rounded-full', HEALTH_DOT[p.health])}
                      />
                      <span className="min-w-0 flex-1 truncate">{p.shortLabel}</span>
                      <span className="shrink-0 text-[12px] text-[#8F8F8F] tabular-nums">{pct} %</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
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
