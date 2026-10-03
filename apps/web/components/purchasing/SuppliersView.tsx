'use client';

import type { SupplierDto } from '@batimint/contracts';
import { formatEnterpriseNumber, formatIban } from '@batimint/domain';
import {
  Button,
  Checkbox,
  Chip,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Table,
  Td,
  TextField,
  Th,
} from '@batimint/ui';
import { Plus, Truck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { SearchInput } from '@/components/SearchInput';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useDebounced } from '@/lib/use-debounced';
import { useErrorMessage } from '@/lib/use-error-message';
import { useNewParam } from '@/lib/use-new-param';
import { PurchasingNav } from './PurchasingNav';

/** Fournisseurs (03 §8) : BCE (→ TVA et identifiant Peppol), e-mail de commande, conditions. */
export function SuppliersView() {
  const t = useTranslations('purchasing.suppliers');
  const tp = useTranslations('purchasing');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 200);
  const [editing, setEditing] = useState<SupplierDto | 'new' | null>(null);
  useNewParam(() => can('purchases.write') && setEditing('new'));
  const list = useApi<{ items: SupplierDto[] }>(
    ['suppliers', 'list', query],
    can('purchases.read') ? `/suppliers${query ? `?q=${encodeURIComponent(query)}` : ''}` : null,
  );
  if (!can('purchases.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;
  const items = list.data?.items ?? [];
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title={tp('title')}
        actions={
          can('purchases.write') ? (
            <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setEditing('new')}>
              {t('new')}
            </Button>
          ) : null
        }
      />
      <PurchasingNav />
      <SearchInput
        label={t('search')}
        placeholder={t('search')}
        value={q}
        onChange={setQ}
        clearLabel={tc('close')}
        loading={list.isFetching && Boolean(query)}
        className="lg:max-w-sm"
      />
      {list.error ? (
        <ErrorState
          title={tc('errorTitle')}
          description={errorMessage(list.error)}
          action={<Button onClick={() => void list.refetch()}>{tc('retry')}</Button>}
        />
      ) : list.isLoading ? (
        <Skeleton className="h-72" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Truck aria-hidden className="size-5" />}
          title={query ? tc('noResults', { q: query }) : t('emptyTitle')}
          description={t('empty')}
          action={
            can('purchases.write') ? <Button onClick={() => setEditing('new')}>{t('new')}</Button> : null
          }
        />
      ) : (
        <Table label={t('title')}>
          <thead>
            <tr>
              <Th>{tc('name')}</Th>
              <Th className="hidden md:table-cell">{t('enterpriseNumber')}</Th>
              <Th className="hidden sm:table-cell">{t('orderEmail')}</Th>
              <Th align="right">{t('terms')}</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className="hover:bg-line-soft/40">
                <Td>
                  <button
                    type="button"
                    disabled={!can('purchases.write')}
                    onClick={() => setEditing(s)}
                    className="flex min-h-11 flex-col justify-center rounded-[8px] text-left focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default"
                  >
                    <span className="flex items-center gap-2 font-medium hover:underline">
                      {s.name}
                      {s.isSubcontractor ? <Chip tone="neutral">{t('subcontractor')}</Chip> : null}
                    </span>
                    <span className="text-[12px] text-muted">{s.city ?? ' '}</span>
                  </button>
                </Td>
                <Td className="hidden font-mono text-[13px] md:table-cell">
                  {s.enterpriseNumber ? formatEnterpriseNumber(s.enterpriseNumber) : '—'}
                  {s.peppolId ? (
                    <span className="block text-[12px] text-muted">Peppol {s.peppolId}</span>
                  ) : null}
                </Td>
                <Td className="hidden text-[14px] sm:table-cell">{s.orderEmail ?? s.email ?? '—'}</Td>
                <Td align="right" className="text-[14px]">
                  {t('termsDays', { n: s.paymentTermsDays })}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing ? (
        <SupplierDialog supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

export function SupplierDialog({
  supplier,
  onClose,
  onCreated,
  subcontractor = false,
}: {
  supplier: SupplierDto | null;
  onClose: () => void;
  onCreated?: (s: SupplierDto) => void;
  /** Création depuis la sous-traitance : coché d'office. */
  subcontractor?: boolean;
}) {
  const t = useTranslations('purchasing.suppliers');
  const tc = useTranslations('common');
  const [form, setForm] = useState({
    name: supplier?.name ?? '',
    enterpriseNumber: supplier?.enterpriseNumber ? formatEnterpriseNumber(supplier.enterpriseNumber) : '',
    email: supplier?.email ?? '',
    orderEmail: supplier?.orderEmail ?? '',
    phone: supplier?.phone ?? '',
    street: supplier?.street ?? '',
    postalCode: supplier?.postalCode ?? '',
    city: supplier?.city ?? '',
    iban: supplier?.iban ? formatIban(supplier.iban) : '',
    paymentTermsDays: String(supplier?.paymentTermsDays ?? 30),
    isSubcontractor: supplier?.isSubcontractor ?? subcontractor,
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useApiMutation<void, SupplierDto>(
    () => ({
      path: supplier ? `/suppliers/${supplier.id}` : '/suppliers',
      method: supplier ? 'PUT' : 'POST',
      body: {
        name: form.name.trim(),
        enterpriseNumber: form.enterpriseNumber.trim() || null,
        email: form.email.trim() || null,
        orderEmail: form.orderEmail.trim() || null,
        phone: form.phone.trim() || null,
        street: form.street.trim() || null,
        postalCode: form.postalCode.trim() || null,
        city: form.city.trim() || null,
        iban: form.iban.trim() || null,
        paymentTermsDays: Number(form.paymentTermsDays),
        isSubcontractor: form.isSubcontractor,
      },
    }),
    {
      invalidate: [['suppliers'], ['subcontractors']],
      successMessage: supplier ? t('updated') : t('created'),
      onSuccess: (s) => {
        onCreated?.(s);
        onClose();
      },
    },
  );
  const submit = () => {
    const days = Number(form.paymentTermsDays);
    if (form.name.trim().length < 2) return setError(t('errors.name'));
    if (!Number.isInteger(days) || days < 0 || days > 120) return setError(t('errors.terms'));
    setError(null);
    save.mutate();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={supplier ? t('editTitle') : t('new')}
      description={t('dialogHint')}
      closeLabel={tc('close')}
      className="w-[min(94vw,640px)]"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField
          label={tc('name')}
          required
          value={form.name}
          onChange={set('name')}
          containerClassName="sm:col-span-2"
        />
        <TextField
          label={t('enterpriseNumber')}
          hint={t('enterpriseHint')}
          inputMode="numeric"
          value={form.enterpriseNumber}
          onChange={set('enterpriseNumber')}
        />
        <TextField label={t('iban')} value={form.iban} onChange={set('iban')} />
        <TextField
          label={t('orderEmail')}
          type="email"
          value={form.orderEmail}
          onChange={set('orderEmail')}
        />
        <TextField label={tc('email')} type="email" value={form.email} onChange={set('email')} />
        <TextField label={tc('phone')} type="tel" value={form.phone} onChange={set('phone')} />
        <TextField
          label={t('terms')}
          inputMode="numeric"
          value={form.paymentTermsDays}
          onChange={set('paymentTermsDays')}
          trailing={<span className="pr-2 text-[14px] text-muted">{t('days')}</span>}
        />
        <TextField
          label={t('street')}
          value={form.street}
          onChange={set('street')}
          containerClassName="sm:col-span-2"
        />
        <TextField
          label={t('postalCode')}
          inputMode="numeric"
          value={form.postalCode}
          onChange={set('postalCode')}
        />
        <TextField label={t('city')} value={form.city} onChange={set('city')} />
        <Checkbox
          label={t('isSubcontractor')}
          className="sm:col-span-2"
          checked={form.isSubcontractor}
          onChange={(e) => setForm((f) => ({ ...f, isSubcontractor: e.target.checked }))}
        />
        <button type="submit" hidden />
      </form>
      {error ? (
        <p role="alert" className="mt-3 text-[14px] text-crit">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
