'use client';

import { cn } from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronsUpDown, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

export function UserMenu() {
  const t = useTranslations();
  const me = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const logout = async () => {
    await api('/auth/logout', { method: 'POST', idempotencyKey: false }).catch(() => undefined);
    queryClient.clear();
    router.replace('/connexion');
    router.refresh();
  };

  const switchTenant = async (tenantId: string) => {
    await api('/auth/switch-tenant', { body: { tenantId } });
    queryClient.clear();
    setOpen(false);
    router.refresh();
  };

  const initials = me.user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-[12px] p-2 text-left hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#7D93FF]"
      >
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-[13px] font-semibold"
        >
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-white">{me.user.name}</span>
          <span className="block truncate text-[12px] text-[#B8B8B8]">
            {me.tenant?.name} · {me.role ? t(`roles.${me.role}`) : ''}
          </span>
        </span>
        <ChevronsUpDown aria-hidden className="size-4 text-[#B8B8B8]" />
      </button>
      {open ? (
        <div
          id={menuId}
          className="absolute bottom-full left-0 mb-2 w-full rounded-[12px] border border-[#333333] bg-[#1C1C1C] p-1.5 shadow-none"
        >
          {me.tenants.length > 1 ? (
            <div className="border-b border-[#333333] pb-1.5 mb-1.5">
              <p className="px-2.5 py-1.5 text-[11px] tracking-[0.08em] text-[#9A9A9A] uppercase">
                {t('nav.switchTenant')}
              </p>
              {me.tenants.map((tenant) => (
                <button
                  key={tenant.id}
                  type="button"
                  onClick={() => void switchTenant(tenant.id)}
                  aria-current={tenant.id === me.tenant?.id ? 'true' : undefined}
                  className={cn(
                    'flex h-10 w-full items-center rounded-[8px] px-2.5 text-left text-[13px] hover:bg-white/10',
                    tenant.id === me.tenant?.id ? 'font-semibold text-white' : 'text-[#CFCFCF]',
                  )}
                >
                  {tenant.name}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void logout()}
            className="flex h-10 w-full items-center gap-2 rounded-[8px] px-2.5 text-[13px] text-[#CFCFCF] hover:bg-white/10 hover:text-white"
          >
            <LogOut aria-hidden className="size-4" />
            {t('nav.logout')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
