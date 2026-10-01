import type { ReactNode } from 'react';
import { cn } from './cn';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-[8px] bg-line-soft motion-reduce:animate-none', className)}
    />
  );
}

/** État vide : une phrase et une action, jamais un écran blanc (02, exigences transverses). */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-[16px] border border-dashed border-line bg-surface px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="flex size-12 items-center justify-center rounded-full bg-line-soft text-ink">
          {icon}
        </div>
      ) : null}
      <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
      {description ? <div className="max-w-md text-[14px] text-muted">{description}</div> : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-[16px] border border-crit/30 bg-surface p-5"
    >
      <h2 className="text-[15px] font-semibold text-crit">{title}</h2>
      {description ? <div className="text-[14px] text-ink">{description}</div> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function Notice({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: 'neutral' | 'warn' | 'good' | 'accent' | 'crit';
  title?: string;
  children: ReactNode;
}) {
  const border = {
    neutral: 'border-line',
    warn: 'border-warn/40',
    good: 'border-good/40',
    accent: 'border-accent/40',
    crit: 'border-crit/40',
  }[tone];
  const color = {
    neutral: 'text-ink',
    warn: 'text-warn',
    good: 'text-good',
    accent: 'text-accent',
    crit: 'text-crit',
  }[tone];
  return (
    <div className={cn('rounded-[12px] border bg-surface px-4 py-3 text-[14px]', border)}>
      {title ? <p className={cn('font-semibold', color)}>{title}</p> : null}
      <div className="text-ink">{children}</div>
    </div>
  );
}
