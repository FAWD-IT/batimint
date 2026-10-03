'use client';

import { Button, Dialog, Notice, Segmented, TextAreaField, TextField } from '@batimint/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { useApiMutation } from '@/lib/hooks';
import { useErrorMessage } from '@/lib/use-error-message';

type Source = 'phone' | 'manual';

/** Saisie d'une demande (appel, visite au dépôt…) : la fiche prospect et l'affaire suivent seules. */
export function LeadDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('leads');
  const tc = useTranslations('common');
  const tw = useTranslations('webform.public');
  const errorMessage = useErrorMessage();
  const [source, setSource] = useState<Source>('phone');
  const [v, setV] = useState({
    name: '',
    email: '',
    phone: '',
    companyName: '',
    street: '',
    postalCode: '',
    city: '',
    message: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useApiMutation<Record<string, unknown>>((body) => ({ path: '/leads', body }), {
    invalidate: [['leads'], ['opportunities'], ['customers']],
    successMessage: t('saved'),
    onSuccess: onClose,
    silentError: true,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (v.name.trim().length < 2) errs['name'] = t('nameRequired');
    if (!v.email.trim() && !v.phone.trim()) errs['phone'] = t('contactRequired');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    save.mutate({ source, ...v });
  };
  const field = (k: keyof typeof v) => ({
    value: v[k],
    onChange: (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value }),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('new')}
      description={t('newDescription')}
      closeLabel={tc('close')}
      className="w-[min(94vw,600px)]"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="lead-form" loading={save.isPending}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id="lead-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {save.error ? <Notice tone="crit">{errorMessage(save.error)}</Notice> : null}
        <Segmented<Source>
          label={tc('source')}
          value={source}
          onChange={setSource}
          options={[
            { value: 'phone', label: t('source.phone') },
            { value: 'manual', label: t('source.manual') },
          ]}
        />
        <TextField label={t('name')} {...field('name')} error={errors['name']} required autoFocus />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={tc('phone')} type="tel" {...field('phone')} error={errors['phone']} />
          <TextField label={tc('email')} type="email" {...field('email')} />
        </div>
        <TextField label={t('companyName')} {...field('companyName')} optionalLabel={tc('optional')} />
        <TextField label={tw('street')} {...field('street')} />
        <div className="grid grid-cols-[120px_1fr] gap-4">
          <TextField label={tw('postalCode')} inputMode="numeric" {...field('postalCode')} />
          <TextField label={tw('city')} {...field('city')} />
        </div>
        <TextAreaField label={t('message')} {...field('message')} placeholder={tw('messagePlaceholder')} />
      </form>
    </Dialog>
  );
}
