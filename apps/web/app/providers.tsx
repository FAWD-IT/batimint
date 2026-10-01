'use client';

import { ToastProvider } from '@batimint/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { ApiError } from '@/lib/api';

export function Providers({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ToastProvider closeLabel={t('close')}>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
