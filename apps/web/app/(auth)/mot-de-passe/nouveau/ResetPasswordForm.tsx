'use client';

import { Button, Notice } from '@batimint/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { PasswordField } from '@/components/PasswordField';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';

export function ResetPasswordForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');
  const errorMessage = useErrorMessage();
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 10) {
      setFieldError(t('validation.password'));
      return;
    }
    setFieldError(null);
    setPending(true);
    try {
      await api('/auth/password/reset', { body: { token, password }, idempotencyKey: false });
      router.replace('/aujourdhui');
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <AuthCard
      title={t('resetTitle')}
      subtitle={t('resetSubtitle')}
      footer={
        <Link href="/connexion" className="font-semibold text-ink underline-offset-4 hover:underline">
          {t('backToLogin')}
        </Link>
      }
    >
      {!token ? (
        <Notice tone="crit">{t('missingToken')}</Notice>
      ) : (
        <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          {error ? <Notice tone="crit">{error}</Notice> : null}
          <PasswordField
            label={t('newPassword')}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={t('passwordHint')}
            error={fieldError}
          />
          <Button type="submit" size="lg" fullWidth loading={pending}>
            {t('resetSubmit')}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
