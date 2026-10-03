'use client';

import { Button, Notice, TextField } from '@batimint/ui';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';

export default function ForgotPasswordPage() {
  const t = useTranslations('auth');
  const errorMessage = useErrorMessage();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(t('validation.email'));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api('/auth/password/forgot', { body: { email } });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthCard
      title={t('forgotTitle')}
      subtitle={t('forgotSubtitle')}
      footer={
        <Link href="/connexion" className="font-semibold text-ink underline-offset-4 hover:underline">
          {t('backToLogin')}
        </Link>
      }
    >
      {sent ? (
        <Notice tone="good">{t('forgotSent', { email: email.trim() })}</Notice>
      ) : (
        <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <TextField
            label={t('email')}
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
          />
          <Button type="submit" size="lg" fullWidth loading={pending}>
            {t('forgotSend')}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
