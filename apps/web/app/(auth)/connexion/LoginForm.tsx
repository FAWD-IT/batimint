'use client';

import { Button, Notice, TextField } from '@batimint/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { PasswordField } from '@/components/PasswordField';
import { api } from '@/lib/api';
import { safeNext } from '@/lib/safe-next';
import { useErrorMessage } from '@/lib/use-error-message';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const params = useSearchParams();
  const errorMessage = useErrorMessage();
  const [mode, setMode] = useState<'password' | 'magic'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!EMAIL.test(email.trim())) e['email'] = t('validation.email');
    if (mode === 'password' && !password) e['password'] = t('validation.required');
    if (needTotp && !/^\d{6}$/.test(totp)) e['totp'] = t('validation.totp');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setPending(true);
    try {
      if (mode === 'magic') {
        await api('/auth/magic-link', { body: { email } });
        setSentTo(email.trim());
        return;
      }
      const res = await api<{ status: 'ok' | 'mfa_required' }>('/auth/login', {
        body: { email, password, ...(needTotp ? { totp } : {}) },
        idempotencyKey: false,
      });
      if (res.status === 'mfa_required') {
        setNeedTotp(true);
        return;
      }
      router.replace(safeNext(params.get('next')));
      router.refresh();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  if (sentTo) {
    return (
      <AuthCard title={t('loginTitle')}>
        <Notice tone="good">{t('magicLinkSent', { email: sentTo })}</Notice>
        <Button variant="secondary" onClick={() => setSentTo(null)}>
          {t('backToLogin')}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t('loginTitle')}
      subtitle={t('loginSubtitle')}
      footer={
        <>
          {t('noAccount')}{' '}
          <Link href="/inscription" className="font-semibold text-ink underline-offset-4 hover:underline">
            {t('createAccount')}
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        {formError ? <Notice tone="crit">{formError}</Notice> : null}
        <TextField
          label={t('email')}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors['email']}
        />
        {mode === 'password' ? (
          <PasswordField
            label={t('password')}
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors['password']}
          />
        ) : null}
        {needTotp ? (
          <TextField
            label={t('totp')}
            name="totp"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            autoFocus
            value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
            hint={t('totpHint')}
            error={errors['totp']}
          />
        ) : null}
        <Button type="submit" size="lg" fullWidth loading={pending} loadingLabel={t('loggingIn')}>
          {mode === 'magic' ? t('sendMagicLink') : t('login')}
        </Button>
        <div className="flex flex-col items-center gap-2 text-[14px]">
          <button
            type="button"
            className="min-h-11 font-medium text-ink underline-offset-4 hover:underline"
            onClick={() => {
              setMode(mode === 'password' ? 'magic' : 'password');
              setErrors({});
              setFormError(null);
            }}
          >
            {mode === 'password' ? t('magicLinkInstead') : t('passwordInstead')}
          </button>
          {mode === 'password' ? (
            <Link href="/mot-de-passe-oublie" className="text-muted underline-offset-4 hover:text-ink hover:underline">
              {t('forgot')}
            </Link>
          ) : null}
        </div>
      </form>
    </AuthCard>
  );
}
