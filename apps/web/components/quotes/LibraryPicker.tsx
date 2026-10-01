'use client';

import type { ItemDto } from '@batimint/contracts';
import { formatEuros } from '@batimint/domain';
import { cn, Spinner } from '@batimint/ui';
import { Layers, Search, Split } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useDebounced } from '@/lib/use-debounced';

export interface LibraryLine {
  itemId: string;
  code: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: number;
  unitCost?: number;
  laborHours: string;
  vatRate: string;
}

/**
 * Recherche instantanée dans la bibliothèque (P2.3) : Entrée insère la ligne ; un ouvrage peut
 * être inséré tel quel ou éclaté en ses composants.
 */
export function LibraryPicker({
  label,
  onAdd,
  onError,
}: {
  label: string;
  onAdd: (lines: LibraryLine[]) => void;
  onError: (err: unknown) => void;
}) {
  const t = useTranslations('quotes.library');
  const listId = useId();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const query = useDebounced(q.trim(), 120);
  const results = useApi<{ items: ItemDto[] }>(
    ['items', 'quote-picker', query],
    query.length >= 2 ? `/items?q=${encodeURIComponent(query)}&limit=8` : null,
  );
  const items = query.length >= 2 ? (results.data?.items ?? []) : [];

  const pick = async (item: ItemDto, explode = false) => {
    setBusy(true);
    try {
      const r = await api<{ lines: LibraryLine[] }>(`/quotes/library-lines/${item.id}?explode=${explode}`);
      onAdd(r.lines);
      setQ('');
      setActive(0);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute top-3 left-3 size-4 text-muted" />
      <input
        type="search"
        role="combobox"
        aria-label={label}
        aria-expanded={items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={items.length ? `${listId}-${active}` : undefined}
        placeholder={label}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && items[active]) {
            e.preventDefault();
            void pick(items[active]!, e.altKey);
          } else if (e.key === 'Escape') {
            setQ('');
          }
        }}
        className="h-11 w-full rounded-[12px] border border-dashed border-line bg-surface pr-10 pl-9 text-[14px] placeholder:text-muted focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-search-cancel-button]:hidden"
      />
      {busy || results.isFetching ? <Spinner className="absolute top-3.5 right-3 size-4" /> : null}
      {items.length ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-[12px] border border-line bg-surface p-1 shadow-lg"
        >
          {items.map((i, idx) => (
            <li
              key={i.id}
              id={`${listId}-${idx}`}
              role="option"
              aria-selected={idx === active}
              onMouseEnter={() => setActive(idx)}
              onMouseDown={(e) => e.preventDefault()}
              className={cn(
                'flex min-h-11 items-center gap-2 rounded-[8px] px-2 py-1.5',
                idx === active ? 'bg-accent-soft' : '',
              )}
            >
              <button
                type="button"
                tabIndex={-1}
                onClick={() => void pick(i)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                {i.kind === 'assembly' ? (
                  <Layers aria-hidden className="size-4 shrink-0 text-accent" />
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{i.name}</span>
                  <span className="block text-[12px] text-muted">
                    {i.code} · {i.unit}
                  </span>
                </span>
                {i.effectiveSalePrice !== undefined ? (
                  <span className="shrink-0 text-[13px] tabular-nums">
                    {formatEuros(BigInt(i.effectiveSalePrice))}
                  </span>
                ) : null}
              </button>
              {i.kind === 'assembly' ? (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => void pick(i, true)}
                  title={t('explodeHint')}
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[8px] border border-line px-2 text-[12px] font-medium hover:border-ink/40"
                >
                  <Split aria-hidden className="size-3.5" />
                  {t('explode')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : query.length >= 2 && results.data && !results.isFetching ? (
        <p className="mt-1 px-2 text-[13px] text-muted" role="status">
          {t('none', { q: query })}
        </p>
      ) : null}
    </div>
  );
}
