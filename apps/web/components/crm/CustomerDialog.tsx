'use client';

import type { CustomerDto } from '@batimint/contracts';
import { Button, Dialog, Notice, Segmented, Switch, TextAreaField, TextField } from '@batimint/ui';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiMutation } from '@/lib/hooks';
import { useErrorMessage } from '@/lib/use-error-message';

type Kind = 'individual' | 'company';

interface Duplicate {
  id: string;
  reason: 'vat' | 'email' | 'phone';
  displayName?: string;
}

/** Création ou modification d'un client, avec recherche VIES et alerte de doublon (P2.1). */
export function CustomerDialog({
  customer,
  initial,
  onClose,
  onSaved,
}: {
  customer?: CustomerDto | null;
  initial?: Partial<Record<'name' | 'email' | 'phone', string>>;
  onClose: () => void;
  onSaved?: (c: CustomerDto) => void;
}) {
  const t = useTranslations('customers');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const [kind, setKind] = useState<Kind>(customer?.kind ?? 'individual');
  const [nameParts] = useState(() => (initial?.name ?? '').trim().split(/\s+/));
  const [v, setV] = useState({
    firstName: customer?.firstName ?? (nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : ''),
    lastName: customer?.lastName ?? nameParts.at(-1) ?? '',
    companyName: customer?.companyName ?? '',
    legalForm: customer?.legalForm ?? '',
    enterpriseNumber: customer?.enterpriseNumber ?? '',
    vatLiable: customer?.vatLiable ?? false,
    email: customer?.email ?? initial?.email ?? '',
    phone: customer?.phone ?? initial?.phone ?? '',
    street: customer?.street ?? '',
    postalCode: customer?.postalCode ?? '',
    city: customer?.city ?? '',
    paymentTermsDays: customer?.paymentTermsDays?.toString() ?? '',
    notes: customer?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lookup, setLookup] = useState<{ loading: boolean; message: string | null; tone: 'good' | 'warn' }>({
    loading: false,
    message: null,
    tone: 'good',
  });
  const set = (k: keyof typeof v) => (value: string | boolean) => setV((p) => ({ ...p, [k]: value }));

  const save = useApiMutation<Record<string, unknown>, CustomerDto>(
    (body) =>
      customer ? { path: `/customers/${customer.id}`, method: 'PUT', body } : { path: '/customers', body },
    {
      invalidate: [['customers']],
      successMessage: t('saved'),
      silentError: true,
      onSuccess: (c) => {
        onSaved?.(c);
        onClose();
      },
    },
  );
  const duplicates =
    save.error instanceof ApiError && save.error.code === 'possible_duplicate'
      ? ((save.error.details as Duplicate[] | undefined) ?? [])
      : null;

  const runLookup = async () => {
    setLookup({ loading: true, message: null, tone: 'good' });
    try {
      const r = await api<{
        valid: boolean;
        name: string | null;
        legalForm: string | null;
        enterpriseNumber: string | null;
        street: string | null;
        postalCode: string | null;
        city: string | null;
      }>('/company/vat-lookup', { body: { number: v.enterpriseNumber }, idempotencyKey: false });
      if (!r.valid) {
        setLookup({ loading: false, message: t('lookupInvalid'), tone: 'warn' });
        return;
      }
      setV((p) => ({
        ...p,
        companyName: r.name?.replace(/\s+(SRL|SA|SC|SNC|SCS|ASBL|BV|NV|BVBA|SPRL)$/i, '') ?? p.companyName,
        legalForm: r.legalForm ?? p.legalForm,
        enterpriseNumber: r.enterpriseNumber ?? p.enterpriseNumber,
        street: r.street ?? p.street,
        postalCode: r.postalCode ?? p.postalCode,
        city: r.city ?? p.city,
        vatLiable: true,
      }));
      setLookup({ loading: false, message: t('lookupFound', { name: r.name ?? '' }), tone: 'good' });
    } catch (err) {
      setLookup({ loading: false, message: errorMessage(err), tone: 'warn' });
    }
  };

  const submit = (e: FormEvent, force = false) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (kind === 'individual' && !v.lastName.trim()) errs['lastName'] = t('lastNameRequired');
    if (kind === 'company' && !v.companyName.trim()) errs['companyName'] = t('companyNameRequired');
    if (v.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim()))
      errs['email'] = t('emailInvalid');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const terms = v.paymentTermsDays.trim() ? Number.parseInt(v.paymentTermsDays, 10) : null;
    save.mutate({
      kind,
      firstName: kind === 'individual' ? v.firstName : null,
      lastName: kind === 'individual' ? v.lastName : null,
      companyName: kind === 'company' ? v.companyName : null,
      legalForm: kind === 'company' ? v.legalForm : null,
      enterpriseNumber: kind === 'company' ? v.enterpriseNumber : null,
      vatLiable: kind === 'company' ? v.vatLiable : false,
      email: v.email,
      phone: v.phone,
      street: v.street,
      postalCode: v.postalCode,
      city: v.city,
      paymentTermsDays: Number.isFinite(terms) ? terms : null,
      notes: v.notes,
      ...(force ? { force: true } : {}),
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={customer ? t('edit') : t('new')}
      closeLabel={tc('close')}
      className="w-[min(94vw,640px)]"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          {duplicates ? (
            <Button variant="secondary" onClick={(e) => submit(e, true)} loading={save.isPending}>
              {tc('createAnyway')}
            </Button>
          ) : (
            <Button type="submit" form="customer-form" loading={save.isPending}>
              {tc('save')}
            </Button>
          )}
        </>
      }
    >
      <form id="customer-form" noValidate onSubmit={(e) => submit(e)} className="flex flex-col gap-4">
        {duplicates ? (
          <Notice tone="warn" title={t('duplicateTitle')}>
            <ul className="mt-1 flex flex-col gap-1">
              {duplicates.map((d) => (
                <li key={d.id}>
                  <Link href={`/clients/${d.id}`} className="font-semibold underline">
                    {d.displayName ?? d.id}
                  </Link>{' '}
                  <span className="text-muted">({t(`duplicateReason.${d.reason}`)})</span>
                </li>
              ))}
            </ul>
          </Notice>
        ) : save.error ? (
          <Notice tone="crit">{errorMessage(save.error)}</Notice>
        ) : null}
        {!customer ? (
          <Segmented<Kind>
            label={t('kindLabel')}
            value={kind}
            onChange={setKind}
            options={[
              { value: 'individual', label: t('kind.individual') },
              { value: 'company', label: t('kind.company') },
            ]}
          />
        ) : null}
        {kind === 'individual' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('firstName')}
              value={v.firstName}
              onChange={(e) => set('firstName')(e.target.value)}
              autoComplete="off"
              autoFocus
            />
            <TextField
              label={t('lastName')}
              value={v.lastName}
              onChange={(e) => set('lastName')(e.target.value)}
              error={errors['lastName']}
              required
              autoComplete="off"
            />
          </div>
        ) : (
          <>
            <TextField
              label={t('enterpriseNumber')}
              value={v.enterpriseNumber}
              onChange={(e) => set('enterpriseNumber')(e.target.value)}
              placeholder="0123.456.749"
              inputMode="numeric"
              hint={
                lookup.message ? (
                  <span className={lookup.tone === 'good' ? 'text-good' : 'text-warn'}>{lookup.message}</span>
                ) : (
                  t('lookupHint')
                )
              }
              trailing={
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void runLookup()}
                  loading={lookup.loading}
                  disabled={v.enterpriseNumber.replace(/\D/g, '').length < 9}
                  icon={<Search aria-hidden className="size-4" />}
                >
                  {t('lookup')}
                </Button>
              }
              className="pr-36"
              autoFocus
            />
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <TextField
                label={t('companyName')}
                value={v.companyName}
                onChange={(e) => set('companyName')(e.target.value)}
                error={errors['companyName']}
                required
              />
              <TextField
                label={t('legalForm')}
                value={v.legalForm}
                onChange={(e) => set('legalForm')(e.target.value)}
                placeholder="SRL"
              />
            </div>
            <Switch
              label={t('vatLiable')}
              description={t('vatLiableHint')}
              checked={v.vatLiable}
              onChange={(x) => set('vatLiable')(x)}
            />
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={tc('email')}
            type="email"
            value={v.email}
            onChange={(e) => set('email')(e.target.value)}
            error={errors['email']}
            autoComplete="off"
          />
          <TextField
            label={tc('phone')}
            type="tel"
            value={v.phone}
            onChange={(e) => set('phone')(e.target.value)}
            autoComplete="off"
          />
        </div>
        <TextField
          label={t('billingAddress')}
          value={v.street}
          onChange={(e) => set('street')(e.target.value)}
          autoComplete="off"
        />
        <div className="grid grid-cols-[120px_1fr] gap-4">
          <TextField
            label={t('postalCode')}
            value={v.postalCode}
            onChange={(e) => set('postalCode')(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
          />
          <TextField
            label={t('city')}
            value={v.city}
            onChange={(e) => set('city')(e.target.value)}
            autoComplete="off"
          />
        </div>
        <TextField
          label={t('paymentTerms')}
          value={v.paymentTermsDays}
          onChange={(e) => set('paymentTermsDays')(e.target.value.replace(/\D/g, ''))}
          inputMode="numeric"
          optionalLabel={tc('optional')}
          hint={t('paymentTermsHint')}
          containerClassName="max-w-xs"
        />
        <TextAreaField
          label={tc('notes')}
          value={v.notes}
          onChange={(e) => set('notes')(e.target.value)}
          optionalLabel={tc('optional')}
        />
      </form>
    </Dialog>
  );
}
