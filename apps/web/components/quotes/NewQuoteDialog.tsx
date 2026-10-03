'use client';

import type { CustomerDto, QuoteDto, QuoteSummaryDto } from '@batimint/contracts';
import { Button, Dialog, Notice, SelectField, TextField } from '@batimint/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { CustomerPicker } from '@/components/crm/CustomerPicker';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useErrorMessage } from '@/lib/use-error-message';

/** Nouveau devis : depuis une affaire (client et adresse repris), un client, ou un modèle. */
export function NewQuoteDialog({
  opportunity,
  onClose,
}: {
  opportunity?: { id: string; title: string; customerName: string } | null;
  onClose: () => void;
}) {
  const t = useTranslations('quotes.new');
  const tc = useTranslations('common');
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [customer, setCustomer] = useState<CustomerDto | null>(null);
  const [title, setTitle] = useState(opportunity?.title ?? '');
  const [templateId, setTemplateId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [id] = useState(() => uuidv7());
  const templates = useApi<{ items: QuoteSummaryDto[] }>(['quotes', 'templates'], '/quotes?templates=true');
  const create = useApiMutation<Record<string, unknown>, QuoteDto>((body) => ({ path: '/quotes', body }), {
    invalidate: [['quotes'], ['opportunities']],
    onSuccess: (q) => router.push(`/devis/${q.id}`),
    silentError: true,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!opportunity && !customer) return setError(t('customerRequired'));
    if (title.trim().length < 2) return setError(t('titleRequired'));
    setError(null);
    create.mutate({
      id,
      title: title.trim(),
      ...(opportunity ? { opportunityId: opportunity.id } : { customerId: customer!.id }),
      ...(templateId ? { fromQuoteId: templateId } : {}),
    });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      description={opportunity ? t('fromOpportunity', { customer: opportunity.customerName }) : undefined}
      closeLabel={tc('close')}
      className="w-[min(94vw,560px)]"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="new-quote" loading={create.isPending}>
            {t('create')}
          </Button>
        </>
      }
    >
      <form id="new-quote" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {error || create.error ? <Notice tone="crit">{error ?? errorMessage(create.error)}</Notice> : null}
        {!opportunity ? (
          customer ? (
            <div className="flex items-center justify-between gap-3 rounded-[12px] border border-line px-3 py-2">
              <span className="font-medium">{customer.displayName}</span>
              <Button size="sm" variant="ghost" onClick={() => setCustomer(null)}>
                {tc('edit')}
              </Button>
            </div>
          ) : (
            <CustomerPicker label={t('customer')} onSelect={setCustomer} autoFocus />
          )
        ) : null}
        <TextField
          label={t('titleLabel')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          autoFocus={Boolean(opportunity)}
        />
        {(templates.data?.items.length ?? 0) > 0 ? (
          <SelectField
            label={t('template')}
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            options={[
              { value: '', label: t('blank') },
              ...templates.data!.items.map((q) => ({ value: q.id, label: q.title })),
            ]}
          />
        ) : null}
      </form>
    </Dialog>
  );
}
