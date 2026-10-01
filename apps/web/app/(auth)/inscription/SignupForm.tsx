'use client';

import { Button, Notice, TextField } from '@batimint/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { PasswordField } from '@/components/PasswordField';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignupForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [values, setValues] = useState({ name: '', companyName: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const e: Record<string, string> = {};
    if (values.name.trim().length < 2) e['name'] = t('validation.name');
    if (values.companyName.trim().length < 2) e['companyName'] = t('validation.companyName');
    if (!EMAIL.test(values.email.trim())) e['email'] = t('validation.email');
    if (values.password.length < 10) e['password'] = t('validation.password');
    setErrors(e);
    if (Object.keys(e).length) return;
    setPending(true);
    try {
      await api('/auth/signup', { body: values, idempotencyKey: false });
      router.replace('/aujourdhui');
      router.refresh();
    } catch (err) {
      setFormError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <AuthCard
      title={t('signupTitle')}
      subtitle={t('signupSubtitle')}
      footer={
        <>
          {t('haveAccount')}{' '}
          <Link href="/connexion" className="font-semibold text-ink underline-offset-4 hover:underline">
            {t('login')}
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        {formError ? <Notice tone="crit">{formError}</Notice> : null}
        <TextField label={t('name')} name="name" autoComplete="name" required value={values.name} onChange={set('name')} error={errors['name']} />
        <TextField
          label={t('companyName')}
          name="companyName"
          autoComplete="organization"
          required
          value={values.companyName}
          onChange={set('companyName')}
          error={errors['companyName']}
        />
        <TextField
          label={t('email')}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          value={values.email}
          onChange={set('email')}
          error={errors['email']}
        />
        <PasswordField
          label={t('password')}
          name="password"
          autoComplete="new-password"
          required
          value={values.password}
          onChange={set('password')}
          hint={t('passwordHint')}
          error={errors['password']}
        />
        <Button type="submit" size="lg" fullWidth loading={pending} loadingLabel={t('signingUp')}>
          {t('signup')}
        </Button>
        <p className="text-center text-[12px] text-muted">{t('terms')}</p>
      </form>
    </AuthCard>
  );
}
