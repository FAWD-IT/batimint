'use client';

import { cn, Spinner } from '@batimint/ui';
import { Search, X } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes } from 'react';

/** Champ de recherche instantanée : libellé lu par les lecteurs d'écran, effacement en un clic. */
export const SearchInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
    label: string;
    value: string;
    onChange: (value: string) => void;
    clearLabel: string;
    loading?: boolean;
  }
>(function SearchInput({ label, value, onChange, clearLabel, loading, className, ...rest }, ref) {
  return (
    <div className={cn('relative w-full', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
      />
      <input
        ref={ref}
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            onChange('');
          }
        }}
        className="h-11 w-full rounded-[12px] border border-line bg-surface pr-11 pl-9 text-[15px] text-ink placeholder:text-muted hover:border-ink/30 focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-search-cancel-button]:hidden"
        {...rest}
      />
      <div className="absolute inset-y-0 right-1 flex items-center">
        {loading ? (
          <Spinner className="mr-3 size-4" />
        ) : value ? (
          <button
            type="button"
            aria-label={clearLabel}
            onClick={() => onChange('')}
            className="flex size-9 items-center justify-center rounded-[10px] text-muted hover:bg-line-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            <X aria-hidden className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
});
