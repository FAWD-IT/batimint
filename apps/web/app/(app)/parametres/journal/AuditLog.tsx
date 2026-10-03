'use client';

import { Button, EmptyState, ErrorState, PageHeader, Skeleton } from '@batimint/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { useCan } from '@/lib/session';

interface Entry {
  id: string;
  actorType: string;
  actorLabel: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  changes: unknown;
  occurredAt: string;
}

function summarize(changes: unknown): string {
  if (!changes || typeof changes !== 'object') return '';
  const keys = Object.keys(changes as object).filter((k) => !['updatedAt'].includes(k));
  return keys.slice(0, 6).join(', ') + (keys.length > 6 ? '…' : '');
}

export function AuditLog() {
  const t = useTranslations('settings.audit');
  const ts = useTranslations('settings');
  const tc = useTranslations('common');
  const format = useFormatter();
  const can = useCan();
  const q = useInfiniteQuery({
    queryKey: ['audit'],
    queryFn: ({ pageParam }) =>
      api<{ items: Entry[]; nextCursor: string | null }>(
        `/audit?limit=50${pageParam ? `&before=${pageParam}` : ''}`,
      ),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: can('audit.read'),
  });
  if (!can('audit.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader breadcrumb={<Link href="/parametres">{ts('title')}</Link>} title={t('title')} />
      {q.isLoading ? (
        <Skeleton className="h-64" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<History aria-hidden className="size-5" />}
          title={t('title')}
          description={t('empty')}
        />
      ) : (
        <ol className="flex flex-col rounded-[16px] border border-line bg-surface">
          {items.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line-soft px-5 py-3 last:border-b-0"
            >
              <time dateTime={e.occurredAt} className="w-36 shrink-0 text-[13px] text-muted tabular-nums">
                {format.dateTime(new Date(e.occurredAt), { dateStyle: 'short', timeStyle: 'short' })}
              </time>
              <span className="min-w-0 flex-1 text-[14px]">
                <code className="text-[13px] font-semibold">{e.action}</code>
                {summarize(e.changes) ? <span className="text-muted"> · {summarize(e.changes)}</span> : null}
              </span>
              <span className="text-[13px] text-muted">
                {t('actor')}{' '}
                {e.actorType === 'system'
                  ? t('system')
                  : e.actorType === 'platform_admin'
                    ? `${t('platformAdmin')} (${e.actorLabel ?? ''})`
                    : (e.actorLabel ?? '—')}
              </span>
            </li>
          ))}
        </ol>
      )}
      {q.hasNextPage ? (
        <Button
          variant="secondary"
          className="self-center"
          onClick={() => void q.fetchNextPage()}
          loading={q.isFetchingNextPage}
        >
          {t('loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
