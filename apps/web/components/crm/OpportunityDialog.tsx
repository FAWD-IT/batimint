'use client';

import type { CustomerDto, OpportunityDto } from '@batimint/contracts';
import { Button, Dialog, Notice, SelectField, TextAreaField, TextField } from '@batimint/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { MoneyInput } from '@/components/MoneyInput';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { CustomerDialog } from './CustomerDialog';
import { CustomerPicker } from './CustomerPicker';

export const TRADES = ['general', 'roofing', 'electrical', 'plumbing'] as const;

interface SiteOption {
  id: string;
  label: string | null;
  street: string;
  postalCode: string;
  city: string;
}

/** Nouvelle affaire : client (existant ou créé à la volée), adresse de chantier, intitulé. */
export function OpportunityDialog({
  customer: presetCustomer,
  onClose,
  onCreated,
}: {
  customer?: CustomerDto | null;
  onClose: () => void;
  onCreated?: (o: OpportunityDto) => void;
}) {
  const t = useTranslations('pipeline');
  const tl = useTranslations('library');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const [customer, setCustomer] = useState<CustomerDto | null>(presetCustomer ?? null);
  const [newCustomerName, setNewCustomerName] = useState<string | null>(null);
  const [v, setV] = useState({ title: '', amount: 0, trade: '', description: '' });
  /** null = adresse par défaut (la première du client). */
  const [chosenSite, setChosenSite] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const detail = useApi<{ sites: SiteOption[] }>(
    ['customers', customer?.id, 'detail'],
    customer ? `/customers/${customer.id}` : null,
  );
  const sites = detail.data?.sites ?? [];
  const siteId = chosenSite ?? sites[0]?.id ?? '';

  const create = useApiMutation<Record<string, unknown>, OpportunityDto>(
    (body) => ({ path: '/opportunities', body }),
    {
      invalidate: [['opportunities']],
      successMessage: t('created'),
      onSuccess: (o) => {
        onCreated?.(o);
        onClose();
      },
      silentError: true,
    },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!customer) return setError(t('customerRequired'));
    if (v.title.trim().length < 2) return setError(t('titleRequired'));
    setError(null);
    create.mutate({
      customerId: customer.id,
      siteId: siteId || null,
      title: v.title.trim(),
      description: v.description,
      trade: v.trade || null,
      ...(can('pricing.read') && v.amount ? { estimatedAmount: v.amount } : {}),
    });
  };

  if (newCustomerName !== null)
    return (
      <CustomerDialog
        initial={{ name: newCustomerName }}
        onClose={() => setNewCustomerName(null)}
        onSaved={(c) => {
          setCustomer(c);
          setNewCustomerName(null);
        }}
      />
    );

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('new')}
      closeLabel={tc('close')}
      className="w-[min(94vw,600px)]"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="opportunity-form" loading={create.isPending} disabled={!customer}>
            {tc('create')}
          </Button>
        </>
      }
    >
      <form id="opportunity-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {error || create.error ? <Notice tone="crit">{error ?? errorMessage(create.error)}</Notice> : null}
        {customer ? (
          <div className="flex items-center justify-between gap-3 rounded-[12px] border border-line px-3 py-2">
            <span className="min-w-0">
              <span className="block text-[12px] text-muted">{t('customer')}</span>
              <span className="block truncate font-medium">{customer.displayName}</span>
            </span>
            {!presetCustomer ? (
              <Button size="sm" variant="ghost" onClick={() => setCustomer(null)}>
                {t('changeCustomer')}
              </Button>
            ) : null}
          </div>
        ) : (
          <CustomerPicker
            label={t('chooseCustomer')}
            onSelect={(c) => {
              setCustomer(c);
              setChosenSite(null);
            }}
            onCreate={can('customers.write') ? setNewCustomerName : undefined}
            autoFocus
          />
        )}
        {customer ? (
          <>
            <SelectField
              label={t('site')}
              value={siteId}
              onChange={(e) => setChosenSite(e.target.value)}
              hint={sites.length === 0 ? t('noSiteHint') : undefined}
              options={[
                ...sites.map((s) => ({ value: s.id, label: siteText(s) })),
                { value: '', label: t('noSite') },
              ]}
            />
            <TextField
              label={t('title_')}
              value={v.title}
              onChange={(e) => setV({ ...v, title: e.target.value })}
              placeholder={t('titlePlaceholder')}
              required
              autoFocus={Boolean(presetCustomer)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label={t('trade')}
                value={v.trade}
                onChange={(e) => setV({ ...v, trade: e.target.value })}
                options={[
                  { value: '', label: tc('none') },
                  ...TRADES.map((x) => ({ value: x, label: tl(`trades.${x}`) })),
                ]}
              />
              {can('pricing.read') ? (
                <MoneyInput
                  label={t('estimated')}
                  cents={v.amount}
                  onChange={(amount) => setV((p) => ({ ...p, amount }))}
                />
              ) : null}
            </div>
            <TextAreaField
              label={t('description')}
              value={v.description}
              onChange={(e) => setV({ ...v, description: e.target.value })}
              optionalLabel={tc('optional')}
            />
          </>
        ) : null}
      </form>
    </Dialog>
  );
}

export function siteText(s: SiteOption): string {
  const addr = `${s.street}, ${s.postalCode} ${s.city}`;
  return s.label ? `${s.label} — ${addr}` : addr;
}
