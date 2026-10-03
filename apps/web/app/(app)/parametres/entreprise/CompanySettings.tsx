'use client';

import type { CompanyDto } from '@batimint/contracts';
import { isValidIban, normalizeHex, passesAA } from '@batimint/domain';
import {
  Button,
  Chip,
  ErrorState,
  FormSection,
  Notice,
  PageHeader,
  SelectField,
  Skeleton,
  TextAreaField,
  TextField,
  useToast,
} from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Copy, ImageUp } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { SaveBar } from '@/components/SaveBar';
import { ApiError } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { useFormState } from '@/lib/use-form-state';

type Editable = Pick<
  CompanyDto,
  | 'name'
  | 'legalName'
  | 'legalForm'
  | 'enterpriseNumber'
  | 'street'
  | 'postalCode'
  | 'city'
  | 'country'
  | 'email'
  | 'phone'
  | 'website'
  | 'iban'
  | 'bic'
  | 'brandColor'
  | 'termsAndConditions'
  | 'legalMentions'
  | 'documentLocale'
>;

const pick = (c: CompanyDto): Editable => ({
  name: c.name,
  legalName: c.legalName ?? '',
  legalForm: c.legalForm ?? '',
  enterpriseNumber: c.enterpriseNumber ?? '',
  street: c.street ?? '',
  postalCode: c.postalCode ?? '',
  city: c.city ?? '',
  country: c.country,
  email: c.email ?? '',
  phone: c.phone ?? '',
  website: c.website ?? '',
  iban: c.iban ?? '',
  bic: c.bic ?? '',
  brandColor: c.brandColor ?? '',
  termsAndConditions: c.termsAndConditions ?? '',
  legalMentions: c.legalMentions ?? '',
  documentLocale: c.documentLocale,
});

export function CompanySettings() {
  const t = useTranslations('settings.company');
  const ts = useTranslations('settings');
  const tc = useTranslations('common');
  const format = useFormatter();
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const { data, isLoading, error, refetch } = useApi<CompanyDto>(['company'], '/company');
  const form = useFormState(data ? pick(data) : undefined);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = useApiMutation<Editable, CompanyDto>((body) => ({ path: '/company', method: 'PATCH', body }), {
    successMessage: tc('saved'),
    silentError: true,
    onSuccess: (c) => {
      queryClient.setQueryData(['company'], c);
      void queryClient.invalidateQueries({ queryKey: ['onboarding'] });
    },
  });

  const vies = useApiMutation<
    string,
    {
      valid: boolean;
      name: string | null;
      legalForm: string | null;
      street: string | null;
      postalCode: string | null;
      city: string | null;
    }
  >((number) => ({ path: '/company/vat-lookup', body: { number }, idempotencyKey: false }), {
    onSuccess: (r) => {
      if (!r.valid) return;
      form.setValues((v) =>
        v
          ? {
              ...v,
              legalName: r.name ?? v.legalName,
              legalForm: r.legalForm ?? v.legalForm,
              street: r.street ?? v.street,
              postalCode: r.postalCode ?? v.postalCode,
              city: r.city ?? v.city,
            }
          : v,
      );
    },
  });

  if (!can('company.update'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;
  if (error)
    return (
      <ErrorState
        title={tc('errorTitle')}
        description={errorMessage(error)}
        action={<Button onClick={() => void refetch()}>{tc('retry')}</Button>}
      />
    );
  if (isLoading || !data || !form.values) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  const v = form.values;
  const field = (k: keyof Editable) => ({
    value: (v[k] as string | null) ?? '',
    onChange: (e: { target: { value: string } }) => {
      form.set(k)(e.target.value as never);
      setFieldErrors((errs) => ({ ...errs, [k]: '' }));
    },
    error: fieldErrors[k] || null,
  });

  const onSave = () => {
    const errs: Record<string, string> = {};
    if (v.iban && !isValidIban(v.iban)) errs['iban'] = "Cet IBAN n'est pas valide.";
    if (v.brandColor && !normalizeHex(v.brandColor)) errs['brandColor'] = t('brandColorHint');
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    const changed = Object.fromEntries(
      Object.entries(v).filter(([k, val]) => val !== pick(data)[k as keyof Editable]),
    ) as Editable;
    save.mutate(changed, {
      onError: (err) => {
        if (err instanceof ApiError) {
          const map: Record<string, string> = {
            invalid_iban: 'iban',
            invalid_bic: 'bic',
            invalid_enterprise_number: 'enterpriseNumber',
            invalid_color: 'brandColor',
          };
          const key = map[err.code];
          if (key) setFieldErrors({ [key]: err.message });
          else toast.show({ title: tc('errorTitle'), description: errorMessage(err), tone: 'crit' });
        }
      },
    });
  };

  const uploadLogo = async (file: File) => {
    setUploading(true);
    try {
      const res = await fetch('/api/v1/company/logo', {
        method: 'PUT',
        headers: { 'content-type': file.type },
        body: file,
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new ApiError(res.status, 'logo', body?.error?.message ?? t('logoHint'));
      }
      queryClient.setQueryData(['company'], await res.json());
      void queryClient.invalidateQueries({ queryKey: ['onboarding'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      toast.show({ title: t('logoUploaded'), tone: 'good' });
    } catch (err) {
      toast.show({ title: tc('errorTitle'), description: errorMessage(err), tone: 'crit' });
    } finally {
      setUploading(false);
    }
  };

  const brand = normalizeHex(v.brandColor ?? '');
  const lowContrast = brand ? !passesAA(brand) : false;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 pb-24">
      <PageHeader breadcrumb={<Link href="/parametres">{ts('title')}</Link>} title={t('title')} />
      <div className="rounded-[16px] border border-line bg-surface px-5 py-6 md:px-8">
        <FormSection id="identite" title={t('identity')} description={t('identityDescription')}>
          <TextField label={t('name')} {...field('name')} required />
          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <TextField label={t('legalName')} {...field('legalName')} />
            <TextField label={t('legalForm')} {...field('legalForm')} />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <TextField
                containerClassName="flex-1"
                label={t('enterpriseNumber')}
                inputMode="numeric"
                {...field('enterpriseNumber')}
              />
              <Button
                variant="secondary"
                loading={vies.isPending}
                onClick={() => vies.mutate(v.enterpriseNumber ?? '')}
                disabled={!v.enterpriseNumber}
              >
                {t('checkVies')}
              </Button>
            </div>
            {data.vatValidatedAt ? (
              <Chip tone="good" className="self-start">
                <BadgeCheck aria-hidden className="size-3.5" />
                {t('vatValidated', {
                  date: format.dateTime(new Date(data.vatValidatedAt), { dateStyle: 'medium' }),
                })}{' '}
                · {data.vatNumber}
              </Chip>
            ) : (
              <Chip tone="warn" dot className="self-start">
                {t('vatNotValidated')}
              </Chip>
            )}
          </div>
        </FormSection>

        <FormSection id="adresse" title={t('address')}>
          <TextField label={t('street')} autoComplete="street-address" {...field('street')} />
          <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
            <TextField label={t('postalCode')} autoComplete="postal-code" {...field('postalCode')} />
            <TextField label={t('city')} autoComplete="address-level2" {...field('city')} />
          </div>
        </FormSection>

        <FormSection id="coordonnees" title={t('contact')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t('email')} type="email" {...field('email')} />
            <TextField label={t('phone')} type="tel" {...field('phone')} />
          </div>
          <TextField label={t('website')} type="url" {...field('website')} />
        </FormSection>

        <FormSection id="banque" title={t('bank')} description={t('bankDescription')}>
          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <TextField label={t('iban')} {...field('iban')} />
            <TextField label={t('bic')} {...field('bic')} />
          </div>
        </FormSection>

        <FormSection id="image" title={t('branding')} description={t('brandingDescription')}>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-20 w-40 items-center justify-center overflow-hidden rounded-[12px] border border-dashed border-line bg-bg">
              {data.logoUrl ? (
                <img
                  src={data.logoUrl}
                  alt={t('logo')}
                  className="max-h-full max-w-full object-contain p-2"
                />
              ) : (
                <ImageUp aria-hidden className="size-6 text-muted" />
              )}
            </div>
            <div className="flex flex-col gap-1">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="sr-only"
                aria-label={t('uploadLogo')}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadLogo(f);
                  e.target.value = '';
                }}
              />
              <Button variant="secondary" onClick={() => fileRef.current?.click()} loading={uploading}>
                {data.logoUrl ? t('replaceLogo') : t('uploadLogo')}
              </Button>
              <span className="text-[13px] text-muted">{t('logoHint')}</span>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <TextField
              containerClassName="sm:w-48"
              label={t('brandColor')}
              hint={t('brandColorHint')}
              placeholder="#2F4BFF"
              {...field('brandColor')}
            />
            <input
              type="color"
              aria-label={t('brandColor')}
              value={brand ?? '#2F4BFF'}
              onChange={(e) => form.set('brandColor')(e.target.value.toUpperCase())}
              className="h-11 w-14 cursor-pointer rounded-[10px] border border-line bg-surface p-1 sm:mb-6"
            />
            {brand ? (
              <span
                className="flex h-11 items-center rounded-[12px] px-4 text-[14px] font-semibold text-white sm:mb-6"
                style={{ background: brand }}
              >
                {t('preview')}
              </span>
            ) : null}
          </div>
          {lowContrast ? <Notice tone="warn">{t('brandColorLowContrast')}</Notice> : null}
        </FormSection>

        <FormSection id="conditions" title={t('terms')} description={t('termsDescription')}>
          <TextAreaField label={t('termsAndConditions')} rows={8} {...field('termsAndConditions')} />
          <TextAreaField label={t('legalMentions')} rows={2} {...field('legalMentions')} />
          <SelectField
            label={t('documentLocale')}
            value={v.documentLocale}
            onChange={(e) => form.set('documentLocale')(e.target.value)}
            options={[
              { value: 'fr', label: 'Français' },
              { value: 'nl', label: 'Nederlands' },
            ]}
          />
        </FormSection>

        {data.inboundEmail ? (
          <FormSection id="reception" title={t('inbound')} description={t('inboundDescription')}>
            <div className="flex items-center gap-2">
              <code className="rounded-[8px] bg-line-soft px-3 py-2 text-[14px]">{data.inboundEmail}</code>
              <Button
                variant="ghost"
                size="sm"
                icon={<Copy aria-hidden className="size-4" />}
                onClick={() => {
                  void navigator.clipboard.writeText(data.inboundEmail!);
                  toast.show({ title: tc('copied') });
                }}
              >
                {tc('copy')}
              </Button>
            </div>
          </FormSection>
        ) : null}
      </div>
      <SaveBar dirty={form.dirty} saving={save.isPending} onSave={onSave} onDiscard={form.reset} />
    </div>
  );
}
