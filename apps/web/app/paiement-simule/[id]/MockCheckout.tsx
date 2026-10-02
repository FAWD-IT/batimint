'use client';

import { formatEuros } from '@batimint/domain';
import { Button, Card, ErrorState, Notice, Skeleton } from '@batimint/ui';
import { CreditCard } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

interface Checkout {
  company: string;
  invoiceNumber: string | null;
  amount: number;
  status: string;
}

/**
 * Page de paiement simulée (fournisseur de paiement « mock ») : remplace la page Mollie en
 * développement et en démo ; confirmer suit exactement le chemin du webhook réel.
 */
export function MockCheckout({ id }: { id: string }) {
  const t = useTranslations('mockCheckout');
  const search = useSearchParams();
  const [data, setData] = useState<Checkout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [back, setBack] = useState<string | null>(null);
  // Retour vers le portail : chemin relatif de la même origine uniquement (pas de redirection ouverte).
  useEffect(() => {
    const r = search.get('retour');
    setBack(r && r.startsWith('/') && !r.startsWith('//') ? r : null);
  }, [search]);
  useEffect(() => {
    api<Checkout>(`/payments/checkout/${encodeURIComponent(id)}`)
      .then((d) => {
        setData(d);
        if (d.status === 'paid') setDone(true);
      })
      .catch((err) => setError(err instanceof ApiError && err.message ? err.message : t('error')));
  }, [id, t]);
  const pay = async () => {
    setBusy(true);
    try {
      await api(`/payments/checkout/${encodeURIComponent(id)}/complete`, { body: {} });
      setDone(true);
      if (back) setTimeout(() => window.location.assign(back), 1200);
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : t('error'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-10">
      {error ? (
        <ErrorState title={t('errorTitle')} description={error} />
      ) : !data ? (
        <Skeleton className="h-64" />
      ) : (
        <Card className="flex flex-col gap-4 p-6">
          <Notice tone="accent">{t('simulation')}</Notice>
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-muted">{t('payTo', { company: data.company })}</span>
            <h1 className="text-[28px] font-bold tabular-nums">{formatEuros(BigInt(data.amount))}</h1>
            {data.invoiceNumber ? (
              <span className="text-[14px] text-muted">{t('invoice', { number: data.invoiceNumber })}</span>
            ) : null}
          </div>
          {done ? (
            <Notice tone="good" title={t('paid')}>
              <span role="status">{back ? t('redirecting') : t('close')}</span>
            </Notice>
          ) : (
            <Button
              size="lg"
              variant="accent"
              loading={busy}
              icon={<CreditCard aria-hidden className="size-5" />}
              onClick={() => void pay()}
            >
              {t('pay')}
            </Button>
          )}
          {back && !done ? (
            <a href={back} className="self-center text-[13px] text-muted underline">
              {t('cancel')}
            </a>
          ) : null}
        </Card>
      )}
    </main>
  );
}
