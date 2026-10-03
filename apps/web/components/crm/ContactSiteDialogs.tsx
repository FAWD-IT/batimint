'use client';

import { Button, Checkbox, Dialog, Notice, Switch, TextAreaField, TextField } from '@batimint/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { useApiMutation } from '@/lib/hooks';
import { useErrorMessage } from '@/lib/use-error-message';

export interface ContactRow {
  id: string;
  firstName: string | null;
  lastName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface SiteRow {
  id: string;
  label: string | null;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  isPrivateDwelling: boolean;
  firstOccupancyYear: number | null;
  accessNotes: string | null;
}

export function ContactDialog({
  customerId,
  contact,
  onClose,
}: {
  customerId: string;
  contact: ContactRow | null;
  onClose: () => void;
}) {
  const t = useTranslations('customers');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const [v, setV] = useState({
    firstName: contact?.firstName ?? '',
    lastName: contact?.lastName ?? '',
    jobTitle: contact?.jobTitle ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    isPrimary: contact?.isPrimary ?? false,
  });
  const [missing, setMissing] = useState(false);
  const save = useApiMutation<typeof v>(
    (body) =>
      contact
        ? { path: `/contacts/${contact.id}`, method: 'PUT', body }
        : { path: `/customers/${customerId}/contacts`, body },
    {
      invalidate: [['customers', customerId]],
      successMessage: tc('saved'),
      onSuccess: onClose,
      silentError: true,
    },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!v.lastName.trim()) return setMissing(true);
    save.mutate(v);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={contact ? t('editContact') : t('addContact')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="contact-form" loading={save.isPending}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id="contact-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {save.error ? <Notice tone="crit">{errorMessage(save.error)}</Notice> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('firstName')}
            value={v.firstName}
            onChange={(e) => setV({ ...v, firstName: e.target.value })}
            autoFocus
          />
          <TextField
            label={t('lastName')}
            value={v.lastName}
            onChange={(e) => setV({ ...v, lastName: e.target.value })}
            error={missing && !v.lastName.trim() ? t('lastNameRequired') : null}
            required
          />
        </div>
        <TextField
          label={t('jobTitle')}
          value={v.jobTitle}
          onChange={(e) => setV({ ...v, jobTitle: e.target.value })}
          optionalLabel={tc('optional')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={tc('email')}
            type="email"
            value={v.email}
            onChange={(e) => setV({ ...v, email: e.target.value })}
          />
          <TextField
            label={tc('phone')}
            type="tel"
            value={v.phone}
            onChange={(e) => setV({ ...v, phone: e.target.value })}
          />
        </div>
        <Checkbox
          label={t('primaryContact')}
          checked={v.isPrimary}
          onChange={(e) => setV({ ...v, isPrimary: e.target.checked })}
        />
      </form>
    </Dialog>
  );
}

export function SiteDialog({
  customerId,
  site,
  onClose,
}: {
  customerId: string;
  site: SiteRow | null;
  onClose: () => void;
}) {
  const t = useTranslations('customers');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const [v, setV] = useState({
    label: site?.label ?? '',
    street: site?.street ?? '',
    postalCode: site?.postalCode ?? '',
    city: site?.city ?? '',
    isPrivateDwelling: site?.isPrivateDwelling ?? true,
    firstOccupancyYear: site?.firstOccupancyYear?.toString() ?? '',
    accessNotes: site?.accessNotes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useApiMutation<Record<string, unknown>>(
    (body) =>
      site
        ? { path: `/sites/${site.id}`, method: 'PUT', body }
        : { path: `/customers/${customerId}/sites`, body },
    {
      invalidate: [['customers', customerId]],
      successMessage: tc('saved'),
      onSuccess: onClose,
      silentError: true,
    },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (v.street.trim().length < 2) errs['street'] = t('streetRequired');
    if (v.postalCode.trim().length < 4) errs['postalCode'] = t('postalCodeRequired');
    if (!v.city.trim()) errs['city'] = t('cityRequired');
    const year = v.firstOccupancyYear ? Number.parseInt(v.firstOccupancyYear, 10) : null;
    if (year !== null && (year < 1700 || year > new Date().getFullYear()))
      errs['firstOccupancyYear'] = t('yearInvalid');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    save.mutate({
      label: v.label,
      street: v.street,
      postalCode: v.postalCode,
      city: v.city,
      isPrivateDwelling: v.isPrivateDwelling,
      firstOccupancyYear: v.isPrivateDwelling ? year : null,
      accessNotes: v.accessNotes,
    });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={site ? t('editSite') : t('addSite')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="site-form" loading={save.isPending}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id="site-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {save.error ? <Notice tone="crit">{errorMessage(save.error)}</Notice> : null}
        <TextField
          label={t('siteLabel')}
          value={v.label}
          onChange={(e) => setV({ ...v, label: e.target.value })}
          optionalLabel={tc('optional')}
          placeholder={t('siteLabelPlaceholder')}
        />
        <TextField
          label={t('street')}
          value={v.street}
          onChange={(e) => setV({ ...v, street: e.target.value })}
          error={errors['street']}
          required
          autoFocus
        />
        <div className="grid grid-cols-[120px_1fr] gap-4">
          <TextField
            label={t('postalCode')}
            value={v.postalCode}
            inputMode="numeric"
            onChange={(e) => setV({ ...v, postalCode: e.target.value })}
            error={errors['postalCode']}
            required
          />
          <TextField
            label={t('city')}
            value={v.city}
            onChange={(e) => setV({ ...v, city: e.target.value })}
            error={errors['city']}
            required
          />
        </div>
        <Switch
          label={t('privateDwelling')}
          description={t('privateDwellingHint')}
          checked={v.isPrivateDwelling}
          onChange={(x) => setV({ ...v, isPrivateDwelling: x })}
        />
        {v.isPrivateDwelling ? (
          <TextField
            label={t('firstOccupancy')}
            value={v.firstOccupancyYear}
            inputMode="numeric"
            maxLength={4}
            onChange={(e) => setV({ ...v, firstOccupancyYear: e.target.value.replace(/\D/g, '') })}
            hint={t('firstOccupancyHint')}
            error={errors['firstOccupancyYear']}
            containerClassName="max-w-xs"
          />
        ) : null}
        <TextAreaField
          label={t('access')}
          value={v.accessNotes}
          onChange={(e) => setV({ ...v, accessNotes: e.target.value })}
          optionalLabel={tc('optional')}
        />
      </form>
    </Dialog>
  );
}
