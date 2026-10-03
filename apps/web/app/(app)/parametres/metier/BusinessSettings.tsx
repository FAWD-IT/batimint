'use client';

import type { TenantSettings } from '@batimint/contracts';
import {
  dec,
  eurosToCents,
  formatDocumentNumber,
  formatEuros,
  isValidNumberPattern,
  multiplyCents,
} from '@batimint/domain';
import { Button, ErrorState, FormSection, PageHeader, Skeleton, Switch, TextField } from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { MoneyInput } from '@/components/MoneyInput';
import { SaveBar } from '@/components/SaveBar';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { useFormState } from '@/lib/use-form-state';

const SUGGESTED_RATES = [
  { key: 'ouvrier', label: 'Ouvrier qualifié', costPerHour: 3600, salePerHour: 5200 },
  { key: 'chef', label: 'Chef de chantier', costPerHour: 4400, salePerHour: 6000 },
  { key: 'apprenti', label: 'Apprenti', costPerHour: 2200, salePerHour: 3800 },
];

const DOC_TYPES = [
  'quote',
  'invoice',
  'credit_note',
  'purchase_order',
  'change_order',
  'progress_statement',
  'work_order',
] as const;

function isDecimal(s: string) {
  return /^\d+([.,]\d+)?$/.test(s.trim());
}

export function BusinessSettings() {
  const t = useTranslations('settings.business');
  const ts = useTranslations('settings');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const { data, error, isLoading, refetch } = useApi<TenantSettings>(['settings'], '/company/settings');
  const form = useFormState(data);
  const [dunningText, setDunningText] = useState<string | null>(null);
  const save = useApiMutation<TenantSettings, TenantSettings>(
    (body) => ({ path: '/company/settings', method: 'PUT', body }),
    {
      successMessage: tc('saved'),
      onSuccess: (s) => {
        queryClient.setQueryData(['settings'], s);
        void queryClient.invalidateQueries({ queryKey: ['onboarding'] });
      },
    },
  );

  if (!can('settings.update'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;
  if (error)
    return (
      <ErrorState
        title={tc('errorTitle')}
        description={errorMessage(error)}
        action={<Button onClick={() => void refetch()}>{tc('retry')}</Button>}
      />
    );
  if (isLoading || !form.values) return <Skeleton className="mx-auto h-96 max-w-4xl" />;
  const v = form.values;
  const year = new Date().getFullYear();

  const decimalField = (
    k:
      | 'overheadCoefficient'
      | 'marginCoefficient'
      | 'depositPercent'
      | 'retentionPercent'
      | 'driftThresholdPercent',
    label: string,
  ) => (
    <TextField
      label={label}
      inputMode="decimal"
      value={v[k].replace('.', ',')}
      error={isDecimal(v[k]) ? null : 'Nombre attendu'}
      onChange={(e) => form.set(k)(e.target.value.replace(',', '.'))}
    />
  );
  const intField = (
    k:
      | 'breakMinutes'
      | 'paymentTermsDays'
      | 'quoteValidityDays'
      | 'retentionMonths'
      | 'clockInToleranceMeters',
    label: string,
  ) => (
    <TextField
      label={label}
      inputMode="numeric"
      value={String(v[k])}
      onChange={(e) => form.set(k)(Number(e.target.value.replace(/\D/g, '') || 0))}
    />
  );

  let example = '';
  try {
    if (isDecimal(v.overheadCoefficient) && isDecimal(v.marginCoefficient)) {
      example = formatEuros(
        multiplyCents(eurosToCents('100'), dec(v.overheadCoefficient).times(dec(v.marginCoefficient))),
      );
    }
  } catch {
    example = '';
  }

  const valid =
    [
      v.overheadCoefficient,
      v.marginCoefficient,
      v.depositPercent,
      v.retentionPercent,
      v.driftThresholdPercent,
    ].every(isDecimal) &&
    DOC_TYPES.every((d) => isValidNumberPattern(v.numbering[d])) &&
    v.rateProfiles.every((r) => r.key && r.label);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 pb-24">
      <PageHeader breadcrumb={<Link href="/parametres">{ts('title')}</Link>} title={t('title')} />
      <div className="rounded-[16px] border border-line bg-surface px-5 py-6 md:px-8">
        <FormSection id="taux" title={t('rates')} description={t('ratesDescription')}>
          {v.rateProfiles.length === 0 ? (
            <div className="flex flex-col items-start gap-2 rounded-[12px] border border-dashed border-line p-4">
              <p className="text-[14px] text-muted">{t('ratesEmpty')}</p>
              <Button variant="secondary" size="sm" onClick={() => form.set('rateProfiles')(SUGGESTED_RATES)}>
                {t('suggestRates')}
              </Button>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {v.rateProfiles.map((r, i) => {
                const update = (patch: Partial<typeof r>) =>
                  form.set('rateProfiles')(v.rateProfiles.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <li
                    key={i}
                    className="grid items-start gap-3 rounded-[12px] border border-line-soft p-3 sm:grid-cols-[1fr_120px_120px_44px]"
                  >
                    <TextField
                      label={t('rateLabel')}
                      value={r.label}
                      onChange={(e) =>
                        update({
                          label: e.target.value,
                          key:
                            r.key ||
                            e.target.value
                              .toLowerCase()
                              .normalize('NFD')
                              .replace(/[^a-z0-9]+/g, '-')
                              .slice(0, 40),
                        })
                      }
                    />
                    <MoneyInput
                      label={t('cost')}
                      cents={r.costPerHour}
                      onChange={(c) => update({ costPerHour: c })}
                    />
                    <MoneyInput
                      label={t('sale')}
                      cents={r.salePerHour}
                      onChange={(c) => update({ salePerHour: c })}
                    />
                    <Button
                      variant="ghost"
                      className="sm:mt-6"
                      aria-label={t('removeRate', { label: r.label || '—' })}
                      onClick={() => form.set('rateProfiles')(v.rateProfiles.filter((_, j) => j !== i))}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <Button
            variant="ghost"
            className="self-start"
            icon={<Plus aria-hidden className="size-4" />}
            onClick={() =>
              form.set('rateProfiles')([
                ...v.rateProfiles,
                { key: '', label: '', costPerHour: 0, salePerHour: 0 },
              ])
            }
          >
            {t('addRate')}
          </Button>
        </FormSection>

        <FormSection id="coefficients" title={t('coefficients')} description={t('coefficientsDescription')}>
          <div className="grid gap-4 sm:grid-cols-2">
            {decimalField('overheadCoefficient', t('overhead'))}
            {decimalField('marginCoefficient', t('margin'))}
          </div>
          {example ? <p className="text-[13px] text-muted">{t('example', { price: example })}</p> : null}
        </FormSection>

        <FormSection id="temps" title={t('time')}>
          <div className="grid gap-4 sm:grid-cols-3">
            {intField('breakMinutes', t('breakMinutes'))}
            <TextField
              label={t('breakAfter')}
              inputMode="decimal"
              value={String(v.breakAfterMinutes / 60).replace('.', ',')}
              onChange={(e) =>
                form.set('breakAfterMinutes')(Math.round(Number(e.target.value.replace(',', '.') || 0) * 60))
              }
            />
            {intField('clockInToleranceMeters', t('clockTolerance'))}
          </div>
        </FormSection>

        <FormSection id="paiements" title={t('payments')} description={t('b2bNote')}>
          <div className="grid gap-4 sm:grid-cols-3">
            {intField('paymentTermsDays', t('paymentTerms'))}
            {intField('quoteValidityDays', t('quoteValidity'))}
            {decimalField('depositPercent', t('deposit'))}
          </div>
          <TextField
            label={t('dunning')}
            hint={t('dunningHint')}
            value={dunningText ?? v.dunningDays.join(', ')}
            onChange={(e) => {
              setDunningText(e.target.value);
              const days = e.target.value
                .split(/[,;\s]+/)
                .map((x) => Number.parseInt(x, 10))
                .filter((n) => Number.isFinite(n) && n > 0)
                .slice(0, 6);
              form.set('dunningDays')([...new Set(days)].sort((a, b) => a - b));
            }}
          />
          <Switch
            label={t('lateInterest')}
            checked={v.lateInterestEnabled}
            onChange={form.set('lateInterestEnabled')}
          />
          <Switch
            label={t('lumpSum')}
            checked={v.lumpSumIndemnityEnabled}
            onChange={form.set('lumpSumIndemnityEnabled')}
          />
        </FormSection>

        <FormSection id="chantiers" title={t('worksite')}>
          <div className="grid gap-4 sm:grid-cols-3">
            {decimalField('retentionPercent', t('retention'))}
            {intField('retentionMonths', t('retentionMonths'))}
            {decimalField('driftThresholdPercent', t('drift'))}
          </div>
          <Switch
            label={t('approvalB2C')}
            checked={v.progressApprovalB2C}
            onChange={form.set('progressApprovalB2C')}
          />
          <Switch
            label={t('approvalB2B')}
            checked={v.progressApprovalB2B}
            onChange={form.set('progressApprovalB2B')}
          />
        </FormSection>

        <FormSection id="numerotation" title={t('numbering')} description={t('numberingDescription')}>
          <div className="grid gap-4 sm:grid-cols-2">
            {DOC_TYPES.map((d) => {
              const pattern = v.numbering[d];
              const ok = isValidNumberPattern(pattern);
              return (
                <TextField
                  key={d}
                  label={t(`docTypes.${d}`)}
                  value={pattern}
                  error={ok ? null : t('invalidPattern')}
                  hint={
                    ok
                      ? t('nextNumber', { example: formatDocumentNumber(pattern, { year, sequence: 1 }) })
                      : undefined
                  }
                  onChange={(e) => form.set('numbering')({ ...v.numbering, [d]: e.target.value })}
                />
              );
            })}
          </div>
        </FormSection>
      </div>
      <SaveBar
        dirty={form.dirty}
        saving={save.isPending}
        onSave={() => valid && save.mutate(v)}
        onDiscard={form.reset}
      />
    </div>
  );
}
