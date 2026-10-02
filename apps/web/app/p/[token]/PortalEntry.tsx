'use client';

import type { PortalProjectDto } from '@batimint/contracts';
import { Skeleton } from '@batimint/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/portal/PortalShell';
import { api, ApiError } from '@/lib/api';
import { PortalProject } from './PortalProject';
import { PortalQuote } from './PortalQuote';

/**
 * Un lien de portail désigne soit un devis, soit un chantier (jetons distincts) : on essaie le
 * chantier, et un lien de devis s'ouvre sur le devis.
 */
export function PortalEntry({ token }: { token: string }) {
  const t = useTranslations('portal');
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'project'; data: PortalProjectDto }
    | { kind: 'quote' }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });
  useEffect(() => {
    let cancelled = false;
    api<PortalProjectDto>(`/portal/projects/${encodeURIComponent(token)}`)
      .then((data) => !cancelled && setState({ kind: 'project', data }))
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setState({ kind: 'quote' });
        else
          setState({
            kind: 'error',
            message: err instanceof ApiError && err.message ? err.message : t('errors.generic'),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [token, t]);
  if (state.kind === 'project') return <PortalProject token={token} initial={state.data} />;
  if (state.kind === 'quote') return <PortalQuote token={token} />;
  return (
    <PortalShell accent="#111111">
      {state.kind === 'error' ? (
        <div className="flex flex-col gap-3 py-16 text-center">
          <h1 className="text-[22px] font-bold">{t('errors.title')}</h1>
          <p className="text-[15px] text-muted">{state.message}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4 py-6" aria-busy>
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      )}
    </PortalShell>
  );
}
