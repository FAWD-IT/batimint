import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-[16px] border border-line bg-surface p-5 md:p-6', className)} {...rest} />
  );
}

/** Carte héros sombre (--panel-dark) : une seule par écran (08). */
export function HeroCard({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-[16px] bg-panel p-5 text-panel-text md:p-6', className)} {...rest} />;
}

export function Overline({
  className,
  children,
  as: As = 'p',
}: {
  className?: string;
  children: ReactNode;
  as?: 'p' | 'h2' | 'h3';
}) {
  return (
    <As className={cn('text-[12px] font-semibold tracking-[0.08em] text-muted uppercase', className)}>
      {children}
    </As>
  );
}

export function CardTitle({
  className,
  children,
  as: As = 'h2',
}: {
  className?: string;
  children: ReactNode;
  as?: 'h2' | 'h3';
}) {
  return <As className={cn('text-[17px] font-semibold text-ink', className)}>{children}</As>;
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="flex min-w-0 flex-col gap-1.5">
        {breadcrumb ? <div className="text-[13px] text-muted">{breadcrumb}</div> : null}
        <h1 className="text-[24px] leading-tight font-bold tracking-[-0.025em] text-ink md:text-[30px]">
          {title}
        </h1>
        {description ? <div className="text-[14px] text-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
