'use client';

import { Button, Dialog, TextField } from '@batimint/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';

const REASONS = ['price', 'delay', 'competitor', 'abandoned', 'other'] as const;

/** Motif de perte obligatoire (03 §2) : il alimente les statistiques de transformation. */
export function LostReasonDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const t = useTranslations('pipeline');
  const tc = useTranslations('common');
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null);
  const [detail, setDetail] = useState('');
  const [error, setError] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!reason || (reason === 'other' && !detail.trim())) return setError(true);
    const label = t(`lostReasons.${reason}`);
    onConfirm(detail.trim() ? (reason === 'other' ? detail.trim() : `${label} — ${detail.trim()}`) : label);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('lostTitle')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="lost-form" variant="danger">
            {t('markLost')}
          </Button>
        </>
      }
    >
      <form id="lost-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-2 text-[13px] font-semibold">{t('lostReason')}</legend>
          {REASONS.map((r, i) => (
            <label
              key={r}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] border border-line px-3 text-[14px] has-[:checked]:border-ink"
            >
              <input
                type="radio"
                name="lost-reason"
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
                autoFocus={i === 0}
                className="size-4 accent-[var(--ink)]"
              />
              {t(`lostReasons.${r}`)}
            </label>
          ))}
        </fieldset>
        <TextField
          label={t('lostDetail')}
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          optionalLabel={reason === 'other' ? undefined : tc('optional')}
          maxLength={300}
        />
        {error ? (
          <p role="alert" className="text-[13px] text-crit">
            {t('lostReasonRequired')}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
