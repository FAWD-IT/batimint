'use client';

import { cn } from '@batimint/ui';
import { type KeyboardEvent, type ReactNode, useRef } from 'react';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/** Onglets accessibles (motif WAI-ARIA « tabs ») : flèches gauche/droite, Début/Fin. */
export function Tabs<T extends string>({
  label,
  value,
  onChange,
  items,
  idPrefix,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  items: TabItem<T>[];
  idPrefix: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const last = items.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : e.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(items[next]!.value);
  };
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div role="tablist" aria-label={label} className="flex min-w-max gap-1 border-b border-line">
        {items.map((item, i) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${item.value}`}
              aria-selected={selected}
              aria-controls={`${idPrefix}-panel-${item.value}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                '-mb-px flex h-11 items-center gap-1.5 border-b-2 px-3 text-[14px] transition-colors duration-[120ms]',
                'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
                selected
                  ? 'border-ink font-semibold text-ink'
                  : 'border-transparent text-muted hover:text-ink',
              )}
            >
              {item.label}
              {item.count !== undefined ? (
                <span className="rounded-full bg-line-soft px-1.5 text-[12px] text-muted tabular-nums">
                  {item.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TabPanel<T extends string>({
  value,
  idPrefix,
  children,
}: {
  value: T;
  idPrefix: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${value}`}
      aria-labelledby={`${idPrefix}-tab-${value}`}
      tabIndex={0}
      className="outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
    >
      {children}
    </div>
  );
}
