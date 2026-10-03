'use client';

import { Button } from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/** Mode assistance (super-admin, lecture seule) : toujours visible et réversible. */
export function ImpersonationBanner() {
  const t = useTranslations('nav');
  const me = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-full bg-warn py-1 pr-1 pl-3 text-[12px] font-semibold text-white"
    >
      <span>
        {t('impersonating')} · {me.tenant?.name}
      </span>
      <Button
        size="sm"
        variant="inverse"
        className="h-7"
        loading={pending}
        onClick={async () => {
          setPending(true);
          await api('/admin/impersonation/stop', { method: 'POST' });
          queryClient.clear();
          router.replace('/admin');
          router.refresh();
        }}
      >
        {t('stopImpersonation')}
      </Button>
    </div>
  );
}
