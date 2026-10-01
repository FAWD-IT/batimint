'use client';

import type { NotificationDto } from '@batimint/contracts';
import { Button, cn, EmptyState, Skeleton, useToast } from '@batimint/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useRealtimeListener } from '@/lib/realtime';

interface NotificationList {
  items: NotificationDto[];
  unreadCount: number;
}

export function NotificationsBell() {
  const t = useTranslations('notifications');
  const format = useFormatter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<NotificationList>('/notifications'),
  });

  // Le système agit puis informe : chaque notification arrivée en direct s'affiche en toast.
  useRealtimeListener((msg) => {
    if (msg.topic === 'notifications' && typeof msg.data?.['title'] === 'string') {
      toast.show({ title: msg.data['title'] as string, tone: 'accent' });
    }
  });

  const readAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unread = data?.unreadCount ?? 0;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={t('open', { count: unread })}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="relative flex size-11 items-center justify-center rounded-[12px] border border-line bg-surface hover:border-ink/30 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Bell aria-hidden className="size-5" />
        {unread > 0 ? (
          <span
            data-testid="unread-count"
            className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id={panelId}
          className="absolute right-0 z-40 mt-2 w-[min(92vw,380px)] rounded-[16px] border border-line bg-surface p-2"
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <h2 className="text-[15px] font-semibold">{t('title')}</h2>
            {unread > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => readAll.mutate()} loading={readAll.isPending}>
                {t('markAllRead')}
              </Button>
            ) : null}
          </div>
          {isLoading ? (
            <div className="flex flex-col gap-2 p-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : !data?.items.length ? (
            <EmptyState className="border-none py-8" title={t('title')} description={t('empty')} />
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto">
              {data.items.map((n) => {
                const body = (
                  <>
                    <span
                      aria-hidden
                      className={cn(
                        'mt-1.5 size-2 shrink-0 rounded-full',
                        n.readAt ? 'bg-transparent' : 'bg-accent',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-medium text-ink">{n.title}</span>
                      {n.body ? <span className="block text-[13px] text-muted">{n.body}</span> : null}
                      <span className="block text-[12px] text-muted">
                        {format.relativeTime(new Date(n.createdAt))}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link
                        href={n.link}
                        className="flex gap-3 rounded-[10px] p-2 hover:bg-line-soft"
                        onClick={() => setOpen(false)}
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="flex gap-3 rounded-[10px] p-2">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
