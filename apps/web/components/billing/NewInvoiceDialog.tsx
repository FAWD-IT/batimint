'use client';

import type { CustomerDto, InvoiceDto, ProjectSummaryDto } from '@batimint/contracts';
import { Button, Dialog, SelectField, TextField } from '@batimint/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useDebounced } from '@/lib/use-debounced';

/** Nouvelle facture libre ou de régie : client (et chantier facultatif), puis l'éditeur. */
export function NewInvoiceDialog({
  onClose,
  customerId: presetCustomer,
  projectId: presetProject,
}: {
  onClose: () => void;
  customerId?: string;
  projectId?: string;
}) {
  const t = useTranslations('billing.newDialog');
  const tc = useTranslations('common');
  const router = useRouter();
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 200);
  const [customerId, setCustomerId] = useState(presetCustomer ?? '');
  const [projectId, setProjectId] = useState(presetProject ?? '');
  const [type, setType] = useState<'free' | 'work_order'>('free');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const customers = useApi<{ items: CustomerDto[] }>(
    ['customers', 'list', 'invoice', query],
    `/customers?status=customer&limit=50${query ? `&q=${encodeURIComponent(query)}` : ''}`,
  );
  const projects = useApi<{ items: ProjectSummaryDto[] }>(
    ['project', 'list', 'customer', customerId],
    customerId ? `/projects?view=all&customerId=${customerId}` : null,
  );
  const [id] = useState(() => uuidv7());
  const create = useApiMutation<void, InvoiceDto>(
    () => ({
      path: `/invoices/${id}`,
      method: 'PUT',
      body: {
        id,
        type,
        customerId,
        projectId: projectId || null,
        title: title.trim(),
        lines: [
          {
            description: title.trim(),
            unit: 'forfait',
            quantity: '1',
            unitPrice: 0,
            vatRegime: 'standard_21',
          },
        ],
      },
    }),
    { invalidate: [['invoices']], onSuccess: (dto) => router.push(`/facturation/${dto.id}`) },
  );
  const submit = () => {
    if (!customerId) return setError(t('errors.customer'));
    if (title.trim().length < 2) return setError(t('errors.title'));
    setError(null);
    create.mutate();
  };
  const customerOptions = [
    { value: '', label: t('chooseCustomer') },
    ...(customers.data?.items ?? []).map((c) => ({ value: c.id, label: c.displayName })),
  ];
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      description={t('description')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button loading={create.isPending} onClick={submit}>
            {t('create')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {!presetCustomer ? (
          <>
            <TextField label={t('searchCustomer')} value={q} onChange={(e) => setQ(e.target.value)} />
            <SelectField
              label={t('customer')}
              value={customerId}
              options={customerOptions}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setProjectId('');
              }}
            />
          </>
        ) : null}
        {customerId && !presetProject ? (
          <SelectField
            label={t('project')}
            value={projectId}
            options={[
              { value: '', label: t('noProject') },
              ...(projects.data?.items ?? []).map((p) => ({ value: p.id, label: `${p.number} · ${p.name}` })),
            ]}
            onChange={(e) => setProjectId(e.target.value)}
          />
        ) : null}
        <SelectField
          label={t('type')}
          value={type}
          options={[
            { value: 'free', label: t('types.free') },
            { value: 'work_order', label: t('types.work_order') },
          ]}
          onChange={(e) => setType(e.target.value as 'free' | 'work_order')}
        />
        <TextField label={t('invoiceTitle')} value={title} onChange={(e) => setTitle(e.target.value)} />
        <button type="submit" hidden />
        {error ? (
          <p role="alert" className="text-[14px] text-crit">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
