'use client';

import type { CompanyDto } from '@batimint/contracts';
import { Button, Card, Notice, PageHeader, TextField } from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';

interface Lookup {
  valid: boolean;
  enterpriseNumber: string | null;
  name: string | null;
  legalForm: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  source: 'vies' | 'mock' | 'unavailable';
}

/**
 * P1.1-2 : juste après l'inscription, le numéro d'entreprise suffit à pré-remplir la fiche
 * (raison sociale, adresse) via VIES. Tout reste modifiable, et l'étape peut être remise à plus tard.
 */
export function WelcomeView() {
  const t = useTranslations('welcome');
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [number, setNumber] = useState('');
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [form, setForm] = useState({ legalName: '', legalForm: '', street: '', postalCode: '', city: '' });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'lookup' | 'save' | null>(null);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending('lookup');
    try {
      const r = await api<Lookup>('/company/vat-lookup', { body: { number }, idempotencyKey: false });
      setLookup(r);
      setForm({
        legalName: r.name ?? '',
        legalForm: r.legalForm ?? '',
        street: r.street ?? '',
        postalCode: r.postalCode ?? '',
        city: r.city ?? '',
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  const save = async () => {
    setPending('save');
    setError(null);
    try {
      await api<CompanyDto>('/company', {
        method: 'PATCH',
        body: {
          enterpriseNumber: lookup?.enterpriseNumber ?? number,
          legalName: form.legalName,
          legalForm: form.legalForm,
          street: form.street,
          postalCode: form.postalCode,
          city: form.city,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ['onboarding'] });
      router.replace('/aujourdhui');
    } catch (err) {
      setError(errorMessage(err));
      setPending(null);
    }
  };

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <Card className="flex flex-col gap-5">
        <form onSubmit={(e) => void search(e)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <TextField
            containerClassName="flex-1"
            label={t('enterpriseNumber')}
            hint={t('enterpriseNumberHint')}
            inputMode="numeric"
            autoFocus
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
          <Button
            type="submit"
            variant="secondary"
            icon={<Search aria-hidden className="size-4" />}
            loading={pending === 'lookup'}
            className="sm:mb-6"
          >
            {t('lookup')}
          </Button>
        </form>
        {error ? <Notice tone="crit">{error}</Notice> : null}
        {lookup ? (
          <div className="flex flex-col gap-4 border-t border-line-soft pt-5">
            <Notice tone={lookup.valid ? 'good' : 'warn'}>
              {lookup.valid ? t('found') : lookup.source === 'unavailable' ? t('unavailable') : t('notFound')}
            </Notice>
            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <TextField label={t('legalName')} value={form.legalName} onChange={set('legalName')} />
              <TextField label={t('legalForm')} value={form.legalForm} onChange={set('legalForm')} />
            </div>
            <TextField
              label={t('street')}
              value={form.street}
              onChange={set('street')}
              autoComplete="street-address"
            />
            <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
              <TextField
                label={t('postalCode')}
                value={form.postalCode}
                onChange={set('postalCode')}
                autoComplete="postal-code"
              />
              <TextField
                label={t('city')}
                value={form.city}
                onChange={set('city')}
                autoComplete="address-level2"
              />
            </div>
            <Button size="lg" onClick={() => void save()} loading={pending === 'save'}>
              {t('confirm')}
            </Button>
          </div>
        ) : null}
      </Card>
      <Link
        href="/aujourdhui"
        replace
        className="min-h-11 text-[14px] text-muted underline-offset-4 hover:text-ink hover:underline self-center flex items-center"
      >
        {t('skip')}
      </Link>
    </div>
  );
}
