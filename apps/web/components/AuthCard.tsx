import { Card } from '@batimint/ui';
import type { ReactNode } from 'react';

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-6 p-6 md:p-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[24px] leading-tight font-bold tracking-[-0.025em]">{title}</h1>
          {subtitle ? <p className="text-[14px] text-muted">{subtitle}</p> : null}
        </div>
        {children}
      </Card>
      {footer ? <div className="text-center text-[14px] text-muted">{footer}</div> : null}
    </div>
  );
}
