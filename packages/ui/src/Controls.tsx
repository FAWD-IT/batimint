import { type ReactNode, useId } from 'react';
import { cn } from './cn';

/** Interrupteur accessible (role="switch"). */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  const auto = useId();
  const switchId = id ?? auto;
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <div className="flex flex-col">
        <label htmlFor={switchId} className="text-[14px] font-medium text-ink">
          {label}
        </label>
        {description ? <span className="text-[13px] text-muted">{description}</span> : null}
      </div>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-[120ms]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50',
          checked ? 'border-ink bg-ink' : 'border-line bg-line',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'inline-block size-5 rounded-full bg-surface transition-transform duration-[120ms]',
            checked ? 'translate-x-[22px]' : 'translate-x-[3px]',
          )}
        />
      </button>
    </div>
  );
}

export function Avatar({
  name,
  color,
  size = 36,
  className,
}: {
  name: string;
  color?: string;
  size?: number;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        ...(color ? { background: color, color: '#fff' } : {}),
      }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-line-soft font-semibold text-ink',
        className,
      )}
    >
      {initials}
    </span>
  );
}

/** Onglets segmentés (liens ou boutons) avec aria-current. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex w-fit max-w-full shrink-0 rounded-[12px] border border-line bg-surface p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-9 rounded-[9px] px-3.5 text-[14px] font-medium transition-colors duration-[120ms]',
            'focus-visible:outline-2 focus-visible:outline-accent',
            o.value === value ? 'bg-ink text-ink-inverse' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
          {o.count !== undefined ? <span className="ml-1.5 tabular-nums opacity-70">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Table({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn('overflow-x-auto rounded-[16px] border border-line bg-surface', className)}>
      <table aria-label={label} className="w-full border-collapse text-[14px]">
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
  className,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        'sticky top-0 border-b border-line bg-surface px-4 py-3 text-[12px] font-semibold tracking-[0.06em] whitespace-nowrap text-muted uppercase',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  return (
    <td
      className={cn(
        'border-b border-line-soft px-4 py-3 align-middle',
        align === 'right' ? 'text-right tabular-nums' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
    >
      {children}
    </td>
  );
}

/** Section de formulaire : titre, explication, contenu (mise en page 2 colonnes sur desktop). */
export function FormSection({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="grid scroll-mt-24 gap-4 border-b border-line-soft py-6 first:pt-0 last:border-b-0 md:grid-cols-[240px_minmax(0,1fr)] md:gap-8"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description ? <div className="text-[13px] text-muted">{description}</div> : null}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
