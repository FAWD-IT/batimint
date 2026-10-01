'use client';

import type { CustomerDto } from '@batimint/contracts';
import { cn } from '@batimint/ui';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { SearchInput } from '@/components/SearchInput';
import { useApi } from '@/lib/hooks';
import { useDebounced } from '@/lib/use-debounced';

/**
 * Sélecteur de client accessible (combobox ARIA) : recherche floue, flèches + Entrée,
 * et proposition de créer le client tapé s'il n'existe pas.
 */
export function CustomerPicker({
  label,
  onSelect,
  onCreate,
  excludeId,
  autoFocus,
}: {
  label: string;
  onSelect: (c: CustomerDto) => void;
  onCreate?: (name: string) => void;
  excludeId?: string;
  autoFocus?: boolean;
}) {
  const t = useTranslations('pipeline');
  const tc = useTranslations('common');
  const listId = useId();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const query = useDebounced(q.trim(), 150);
  const list = useApi<{ items: CustomerDto[] }>(
    ['customers', 'picker', query],
    `/customers?limit=8${query ? `&q=${encodeURIComponent(query)}` : ''}`,
  );
  const items = (list.data?.items ?? []).filter((c) => c.id !== excludeId);
  const canCreate = Boolean(onCreate && q.trim().length >= 2);
  const count = items.length + (canCreate ? 1 : 0);

  const choose = (index: number) => {
    const c = items[index];
    if (c) onSelect(c);
    else if (canCreate) onCreate?.(q.trim());
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold">{label}</span>
      <SearchInput
        label={label}
        placeholder={t('searchCustomer')}
        value={q}
        onChange={(v) => {
          setQ(v);
          setActive(0);
        }}
        clearLabel={tc('close')}
        loading={list.isFetching}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={count ? `${listId}-${active}` : undefined}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, count - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(active);
          } else if (e.key === 'Escape' && q) {
            e.preventDefault();
            e.stopPropagation();
            setQ('');
          }
        }}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={label}
        className="flex max-h-64 flex-col overflow-y-auto rounded-[12px] border border-line"
      >
        {items.map((c, i) => (
          <li
            key={c.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(i)}
            className={cn(
              'flex min-h-11 cursor-pointer items-center justify-between gap-3 border-b border-line-soft px-3 py-2 last:border-b-0',
              i === active ? 'bg-accent-soft' : 'bg-surface',
            )}
          >
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-medium">{c.displayName}</span>
              <span className="block truncate text-[12px] text-muted">
                {[c.email, c.city].filter(Boolean).join(' · ') || '—'}
              </span>
            </span>
          </li>
        ))}
        {canCreate ? (
          <li
            id={`${listId}-${items.length}`}
            role="option"
            aria-selected={active === items.length}
            onMouseEnter={() => setActive(items.length)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(items.length)}
            className={cn(
              'flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 text-[14px] font-medium',
              active === items.length ? 'bg-accent-soft' : 'bg-surface',
            )}
          >
            <Plus aria-hidden className="size-4" />
            {t('createCustomer', { name: q.trim() })}
          </li>
        ) : null}
        {!count && !list.isLoading ? (
          <li className="px-3 py-3 text-[13px] text-muted">{query ? tc('noResults', { q: query }) : '—'}</li>
        ) : null}
      </ul>
    </div>
  );
}
